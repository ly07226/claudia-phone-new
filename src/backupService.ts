import {validPhaseChatSettings,validChatEventReceipts} from './phasePlay/chatLinkTypes';
import {supportedDataSchema} from './backupFormat';
import {verifyDocumentSnapshot} from './wizardDocumentSnapshot';
import {validateChatHub,hubAssetIds} from './chatHubTypes';
import {validInterruption} from './chatCompletion';
import {validateThemeAppearance} from './themeCSS';
import {validateStoryDatabase,validateStoryPreferences} from './storyValidation';
import {validateScriptConfig} from './scriptValidation';
import {validateMemoryStore} from './memoryValidation';
import {validateBubbleDeletion} from './messageBubbles';
import {validateQuoteReference} from './messageReferences';
import { attachmentImages } from "./imageAttachments";
import { validateTimelineDatabase } from "./timelineValidation";
import { validFriendship } from "./friendTypes";
import Dexie from "dexie";
import { db as phoneDatabase } from "./store";
import {
  acquireBackupGuard,
  checkBackupClients,
  watchBackupArrivals,
} from "./backupGate";
import {
  BackupError, withBackupPhase, type BackupPhase,
  backupSchemas, legacyBackupSchemas, schemasForVersion,
  backupTables,
  backupLimits,
  ensure,
  checkAbort,
  utf8,
  sha,
  tableSeed,
  nextDigest,
  rowBytes,
  decodeValue,
  base64,
  unbase64,
  deriveKey,
  deriveIntegrityKey,
  protectDigest,
  manifestAuthBytes,
  partAAD,
  type BackupTable,
  type BackupManifest,
} from "./backupFormat";
export type BackupProgress = {
  phase: string;
  table?: string;
  records: number;
  bytes: number;
};
type Progress = (value: BackupProgress) => void;
const owned = new Set<string>();
async function temporary(prefix: "stage" | "candidate" | "validation", schemaVersion:5|6|7|9=9) {
  const name = `claudia-backup-${prefix}-${crypto.randomUUID()}`;
  ensure(!(await Dexie.exists(name)), "临时数据库名称冲突，未覆盖任何数据库。");
  const d = new Dexie(name);
  if (prefix === "stage") d.version(1).stores({ parts: "index" });
  else d.version(schemaVersion).stores(schemasForVersion(schemaVersion));
  owned.add(name);
  try {
    await d.open();
    return d;
  } catch (e) {
    d.close();
    await discard(d);
    throw e;
  }
}
async function discard(d: Dexie) {
  ensure(
    owned.has(d.name) &&
      /^claudia-backup-(stage|candidate|validation)-[0-9a-f-]{36}$/.test(
        d.name,
      ),
    "拒绝操作非本次创建的临时数据库。",
  );
  d.close();
  await Dexie.delete(d.name);
  owned.delete(d.name);
}
export async function eachBackupRow(
  d: Dexie,
  table: string,
  fn: (row: any) => Promise<void>,
  signal?: AbortSignal,
) {
  let last: string | undefined;
  while (true) {
    checkAbort(signal);
    const collection =
      last === undefined
        ? d.table(table).orderBy(":id")
        : d.table(table).where(":id").above(last);
    // Bounded primary-key batches avoid one transaction per message.
    // Individual message bodies are never truncated.
    const rows = await collection.limit(32).toArray();
    if (!rows.length) return;
    for (const row of rows) {
      checkAbort(signal);
      const key = row[table === "apiCredentials" ? "configId" : "id"];
      ensure(
        typeof key === "string" && key.length > 0 && key.length < 4096 &&
          (last === undefined || key > last),
        `表 ${table} 存在不支持或重复的主键；没有省略记录。`,
      );
      await fn(row);
      last = key;
    }
  }
}
export function sanitizeConfig(row: any, redactions: BackupManifest["redactions"]) {
  const copy = { ...row };
  const fields: string[] = [];
  for (const key of Object.keys(copy))
    if (
      /^(api.?key|key|token|access.?token|authorization|password|secret)$/i.test(
        key,
      )
    ) {
      delete copy[key];
      fields.push(key);
    }
  if (typeof copy.baseUrl === "string") {
    try {
      const url = new URL(copy.baseUrl);
      if (url.username || url.password || url.search || url.hash) {
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        copy.baseUrl = url.toString();
        fields.push("baseUrl敏感部分（恢复前需重设确认）");
      }
    } catch {
      copy.baseUrl = "";
      fields.push("不可安全解析的baseUrl（恢复前需重设）");
    }
  }
  if (fields.length) redactions.push({ record: row.id, fields });
  return copy;
}
export interface BackupExport {
  manifest: BackupManifest;
  readPart: (index: number) => Promise<Blob>;
  dispose: () => Promise<void>;
}
export async function createBackup(options: {
  database?: Dexie;
  closedOtherClients: boolean;
  includeCredentials?: boolean;
  credentialConsent?: boolean;
  password?: string;
  signal?: AbortSignal;
  onProgress?: Progress;
}): Promise<BackupExport> {
  const db = options.database ?? phoneDatabase;
  ensure(
    options.closedOtherClients,
    "请先关闭其他标签页和独立PWA，并确认后再导出。",
  );
  ensure(
    !options.includeCredentials || options.credentialConsent,
    "包含 API 凭据必须经用户主动确认。",
  );
  const release = acquireBackupGuard();
  const controller = new AbortController();
  const abort = () => controller.abort();
  const hidden = () => {
    if (document.hidden) abort();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", abort);
  const stopArrivals = watchBackupArrivals(abort);
  const deadline = setTimeout(abort, 5 * 60 * 1000);
  let stage: Dexie | undefined;
  let phase:BackupPhase='export-read';
  let pendingWork: Promise<unknown> | undefined;
  // Cooperative cancellation between bounded records avoids aborting Dexie.waitFor's
  // keepalive callback from outside its transaction scope.
  try {
    ensure(!document.hidden, "请保持页面在前台再开始备份。");
    phase='export-read';
    // A PWA may still be opening its IndexedDB connection after a service-worker update.
    // Never inspect backendDB() before Dexie has finished opening the actual database.
    // Distinguish IndexedDB open failures from cross-client preflight failures.
    // Keep user data untouched and avoid leaking arbitrary exception messages.
    try {
      await db.open();
    } catch (error) {
      if (error instanceof BackupError) throw error;
      const kind = error instanceof Error ? error.name : 'Unknown';
      throw new BackupError(
        '无法打开当前小手机数据库（数据库打开阶段，错误类型：'+kind+'）。请勿清理网站数据或卸载小手机。',
        'EXPORT_DB_OPEN',
      );
    }
    checkAbort(controller.signal);
    let coordination: string;
    try {
      coordination = await checkBackupClients();
    } catch (error) {
      if (error instanceof BackupError) throw error;
      const kind = error instanceof Error ? error.name : 'Unknown';
      throw new BackupError(
        '备份前的多窗口检查失败（错误类型：'+kind+'）。没有修改原始数据库。',
        'EXPORT_CLIENT_CHECK',
      );
    }
    checkAbort(controller.signal);
    phase='export-validate';
    ensure(
      supportedDataSchema(db),
      '数据库不是受支持的完整 v7/v8 结构；不会自动迁移、忽略未知表或继续导出。',
    );
    const m: BackupManifest = {
      format: "claudia-phone-backup",
      version: 3,
      codec: 1,
      backupId: crypto.randomUUID(),
      sourceOrigin: location.origin,
      schemaVersion: 9,
      nativeVersion: 90,
      createdAt: new Date().toISOString(),
      snapshotCompletedAt: "",
      coordination,
      tables: {} as BackupManifest["tables"],
      resources: [],
      parts: [],
      credentials: options.includeCredentials ? (options.password ? "encrypted" : "included") : "excluded",
      redactions: [],
    };
    let key: CryptoKey | undefined;
    let integrityKey: CryptoKey | undefined;
    if (options.includeCredentials && options.password) {
      phase='export-encrypt';
      const salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(options.password || "", salt);
      integrityKey = await deriveIntegrityKey(options.password || "", salt);
      m.encryption = {
        algorithm: "AES-GCM",
        integrity: "HMAC-SHA256",
        kdf: "PBKDF2-SHA256",
        iterations: 600000,
        salt: base64(salt),
        authNonce: base64(crypto.getRandomValues(new Uint8Array(12))),
      };
    }
    phase='export-temp';
    stage = await temporary("stage");
    const stageDb = stage;
    let buffer = new Uint8Array(backupLimits.partBytes),
      used = 0,
      bytes = 0,
      records = 0;
    const flush = async () => {
      if (!used) return;
      checkAbort(controller.signal);
      ensure(
        m.parts.length < backupLimits.maxParts,
        "分卷数量超过当前可安全处理的范围，导出已停止。",
      );
      const index = m.parts.length;
      const nonce = key
        ? crypto.getRandomValues(new Uint8Array(12))
        : undefined;
      const previous=phase;phase=key?'export-encrypt':'export-stage';
      const raw = buffer.subarray(0, used);
      const data = key
        ? new Uint8Array(
            await crypto.subtle.encrypt(
              {
                name: "AES-GCM",
                iv: nonce! as BufferSource,
                additionalData: partAAD(m, index) as BufferSource,
              },
              key,
              raw as BufferSource,
            ),
          )
        : raw;
      const part = {
        index,
        name: `${m.backupId}.part-${String(index + 1).padStart(4, "0")}.cphone`,
        bytes: data.length,
        digest: await sha(data),
        ...(nonce ? { nonce: base64(nonce) } : {}),
      };
      checkAbort(controller.signal);
      phase='export-stage';
      await stageDb
        .table("parts")
        .add({ index, data: new Blob([data as BlobPart]) });
      phase=previous;
      m.parts.push(part);
      bytes += data.length;
      used = 0;
    };
    const append = async (data: Uint8Array) => {
      let offset = 0;
      while (offset < data.length) {
        const n = Math.min(buffer.length - used, data.length - offset);
        buffer.set(data.subarray(offset, offset + n), used);
        offset += n;
        used += n;
        if (used === buffer.length) await flush();
      }
    };
    // Never hold one IndexedDB transaction across hashing, encryption, staging,
    // and progress callbacks. IndexedDB auto-commits during asynchronous work.
    // BackupGuard and cross-client coordination protect the source while
    // bounded primary-key reads proceed in separate short transactions.
    {
      phase='export-validate';
      await validateTimelineDatabase(db);
      for (const table of backupTables) {
        const sourceCount = await db.table(table).count();
        const info = {
          schema: backupSchemas[table],
          sourceCount,
          count: 0,
          digest: await Dexie.waitFor(tableSeed(table)),
        };
        m.tables[table] = info;
        if (table === "apiCredentials" && !options.includeCredentials) continue;
        let tableBytes=0;
        await eachBackupRow(
          db,
          table,
          async (original) => {
            pendingWork = (async () => {
              checkAbort(controller.signal);
              if (table === "conversations")
                ensure(
                  !(original.sendingUntil > Date.now()),
                  "检测到仍在生成的会话，请关闭其他客户端并等待请求结束或超时后重试；不会清除生成锁。",
                );
              let row =
                table === "apiConfigs" && !options.includeCredentials
                  ? sanitizeConfig(original, m.redactions)
                  : original;
              if(!options.includeCredentials&&(table==='themes'||table==='conversations')&&row.dedicatedSummaryApi){row={...row,dedicatedSummaryApi:{...sanitizeConfig({...row.dedicatedSummaryApi,id:row.id},m.redactions),apiKey:''}};delete row.dedicatedSummaryApi.id;}
              phase='export-encode';
              if(table==='worlds'&&row.storyDocument)await verifyDocumentSnapshot(row.storyDocument);
              const encoded = await rowBytes(table, row);
              ensure(
                encoded.length <= backupLimits.recordBytes,
                "单条记录超过16MiB安全工作集，导出未完成；没有截断或丢弃记录。请勿进入升级阶段。",
              );
              tableBytes += encoded.length + 1;
              info.digest = await nextDigest(info.digest, encoded);
              await append(encoded);
              await append(utf8("\n"));
              info.count++;
              records++;
              ensure(
                records <= backupLimits.maxRecords,
                "记录数量超过当前安全范围，备份未完成。",
              );
              if (table === "assets") {
                ensure(
                  typeof row.data === "string",
                  "资源不是受支持的数据URL，导出未完成。",
                );
                const data = utf8(row.data);
                m.resources.push({
                  id: row.id,
                  bytes: data.length,
                  digest: await sha(data),
                });
              }
              options.onProgress?.({
                phase: "制作一致快照",
                table,
                records,
                bytes,
              });
            })();
            await pendingWork;
          },
          controller.signal,
        );
        options.onProgress?.({phase:`数据量审计：${table} ${Math.round(tableBytes/1024)} KiB`,table,records,bytes:tableBytes});
      }
      // Reject a changed source table count instead of silently producing
      // an incomplete archive if a concurrent client altered the source.
      for(const table of backupTables){
        const actual=await db.table(table).count();
        ensure(actual===m.tables[table].sourceCount,`备份期间 ${table} 表记录数量发生变化，请重试；未生成不完整文件。`);
      }
      pendingWork = flush();
      await pendingWork;
      checkAbort(controller.signal);
    }
    checkAbort(controller.signal);
    phase=key?'export-encrypt':'export-encode';
    m.snapshotCompletedAt = new Date().toISOString();
    for (const table of backupTables) m.tables[table].digest = await protectDigest(m.tables[table].digest, integrityKey);
    for (const resource of m.resources) resource.digest = await protectDigest(resource.digest, integrityKey);
    if (key && m.encryption)
      m.encryption.authTag = base64(
        new Uint8Array(
          await crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv: unbase64(m.encryption.authNonce) as BufferSource,
              additionalData: manifestAuthBytes(m) as BufferSource,
            },
            key,
            new Uint8Array(),
          ),
        ),
      );
    ensure(
      utf8(JSON.stringify(m)).length <= backupLimits.manifestBytes,
      "清单超过安全大小，备份未完成。",
    );
    checkAbort(controller.signal);
    return {
      manifest: m,
      readPart: async (index) => {
        ensure(
          Number.isInteger(index) &&
            index >= 0 &&
            index < m.parts.length &&
            owned.has(stageDb.name),
          "分卷不可读取，请重新生成备份。",
        );
        const row = await stageDb.table("parts").get(index);
        ensure(row?.data instanceof Blob, "临时分卷缺失，请重新生成。");
        return row.data;
      },
      dispose: () =>
        owned.has(stageDb.name) ? discard(stageDb) : Promise.resolve(),
    };
  } catch (error) {
    await pendingWork?.catch(() => {});
    if (stage && owned.has(stage.name)) await discard(stage).catch(() => {});
    try{checkAbort(controller.signal);}catch(cancelled){throw withBackupPhase(cancelled,phase);}
    throw withBackupPhase(error,phase);
  } finally {
    clearTimeout(deadline);
    stopArrivals();
    release();
    options.signal?.removeEventListener("abort", abort);
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("pagehide", abort);
  }
}

function validateManifest(input: any): asserts input is BackupManifest {
  ensure(
    input?.format === "claudia-phone-backup" &&
      ((input.version === 1 && input.schemaVersion===5 && input.nativeVersion===50)||(input.version===2 && input.schemaVersion===6 && input.nativeVersion===60)||(input.version===3 && ((input.schemaVersion===7 && input.nativeVersion===70)||(input.schemaVersion===9 && input.nativeVersion===90)))) &&
      input.codec === 1,
    "备份格式或数据库版本不受支持，未恢复任何正式数据。",
  );
  if(input.sourceOrigin!==undefined){let valid=false;try{const u=new URL(input.sourceOrigin);valid=["http:","https:"].includes(u.protocol)&&u.origin===input.sourceOrigin;}catch{}ensure(valid,"备份来源信息无效。");}
  ensure(
    typeof input.createdAt === "string" &&
      typeof input.snapshotCompletedAt === "string" &&
      input.createdAt.length < 64 &&
      input.snapshotCompletedAt.length < 64 &&
      Number.isFinite(Date.parse(input.createdAt)) &&
      Number.isFinite(Date.parse(input.snapshotCompletedAt)),
    "备份时间信息无效。",
  );
  ensure(
    typeof input.backupId === "string" &&
      /^[0-9a-f-]{36}$/.test(input.backupId),
    "备份标识无效。",
  );
  ensure(
    ["excluded", "encrypted", "included"].includes(input.credentials),
    "凭据策略无效。",
  );
  ensure(
    input.tables &&
      Object.keys(input.tables).sort().join() ===
        Object.keys(schemasForVersion(input.schemaVersion)).sort().join(),
    "备份未覆盖该版本全部数据表。",
  );
  let total = 0;
  const schemas=schemasForVersion(input.schemaVersion);
  for (const table of Object.keys(schemas) as BackupTable[]) {
    const v = input.tables[table];
    ensure(
      v &&
        v.schema === (schemas as Record<string,string>)[table] &&
        Number.isSafeInteger(v.count) &&
        v.count >= 0 &&
        Number.isSafeInteger(v.sourceCount) &&
        v.sourceCount >= v.count &&
        /^[0-9a-f]{64}$/.test(v.digest),
      "表清单、计数或结构无效。",
    );
    ensure(
      table === "apiCredentials" && input.credentials === "excluded"
        ? v.count === 0
        : v.sourceCount === v.count,
      "表记录存在未说明的省略。",
    );
    total += v.count;
  }
  ensure(total <= backupLimits.maxRecords, "备份记录数量超过安全范围。");
  ensure(
    Array.isArray(input.parts) &&
      (total === 0 ? input.parts.length === 0 : input.parts.length > 0) &&
      input.parts.length <= backupLimits.maxParts,
    "分卷清单无效。",
  );
  input.parts.forEach((p: any, i: number) =>
    ensure(
      p?.index === i &&
        p.name ===
          `${input.backupId}.part-${String(i + 1).padStart(4, "0")}.cphone` &&
        Number.isSafeInteger(p.bytes) &&
        p.bytes > 0 &&
        p.bytes <= backupLimits.partBytes + 16 &&
        /^[0-9a-f]{64}$/.test(p.digest),
      "分卷编号、大小或摘要无效。",
    ),
  );
  ensure(
    Array.isArray(input.resources) &&
      input.resources.length === input.tables.assets.count &&
      input.resources.length <= backupLimits.maxRecords,
    "资源清单数量不一致。",
  );
  const ids = new Set<string>();
  for (const r of input.resources) {
    ensure(
      typeof r?.id === "string" &&
        !ids.has(r.id) &&
        Number.isSafeInteger(r.bytes) &&
        r.bytes >= 0 &&
        r.bytes <= backupLimits.recordBytes &&
        /^[0-9a-f]{64}$/.test(r.digest),
      "资源清单重复或无效。",
    );
    ids.add(r.id);
  }
  ensure(
    Array.isArray(input.redactions) &&
      input.redactions.length <= backupLimits.maxRecords,
    "脱敏清单无效。",
  );
  if (input.credentials === "encrypted") {
    const e = input.encryption;
    ensure(
      e?.algorithm === "AES-GCM" &&
        e.kdf === "PBKDF2-SHA256" &&
        e.iterations === 600000 &&
        typeof e.salt === "string" &&
        e.salt.length <= 64 &&
        typeof e.authNonce === "string" &&
        e.authNonce.length <= 64 &&
        typeof e.authTag === "string" &&
        e.authTag.length <= 64,
      "加密参数无效。",
    );
    ensure(
      unbase64(e.salt).length === 16 &&
        unbase64(e.authNonce).length === 12 &&
        unbase64(e.authTag).length === 16,
      "加密参数长度无效。",
    );
    for (const p of input.parts)
      ensure(
        typeof p.nonce === "string" &&
          p.nonce.length <= 64 &&
          unbase64(p.nonce).length === 12,
        "分卷加密参数无效。",
      );
  } else
    ensure(
      !input.encryption && input.parts.every((p: any) => !p.nonce),
      "明文备份不得含加密凭据标记。",
    );
}
export interface IntegrityReport {
  status: "verified" | "rehearsed";
  formatVersion: 1 | 2 | 3;
  sourceOrigin?: string;
  identities: number;
  dailyVisibleCharacters: number;
  backupId: string;
  snapshotCompletedAt: string;
  manifestDigest: string;
  candidateName?: string;
  schemaVersion: 5 | 6 | 7 | 9;
  counts: Record<string, number>;
  totalRecords: number;
  parts: number;
  resources: number;
  warnings: string[];
  credentials: "excluded" | "encrypted" | "included";
  redactedConfigs: number;
  recordDigestsMatch: true;
  referencesValid: true;
  sourceDatabaseWritten: false;
}
export interface ReadbackResult {
  report: IntegrityReport;
  dispose: () => Promise<void>;
}
const candidates = new WeakMap<ReadbackResult, Dexie>();
export function verifiedCandidate(result: ReadbackResult) {
  const candidate=candidates.get(result);
  ensure(candidate?.isOpen(), "候选备份已关闭，请重新验证。");
  return candidate;
}
export async function readBackup(
  files: File[],
  options: {
    mode: "verify" | "rehearse";
    password?: string;
    signal?: AbortSignal;
    onProgress?: Progress;
    /** Lazy ZIP member resolver; only one part is held in memory at a time. */
    loadPart?: (name:string)=>Promise<File>;
    partNames?: readonly string[];
  },
): Promise<ReadbackResult> {
  const signal = options.signal;
  checkAbort(signal);
  ensure(
    files.length > 0 && files.length <= backupLimits.maxParts + 1,
    "请选择清单及全部分卷文件。",
  );
  const manifests = files.filter((f) => f.name.endsWith(".manifest.json"));
  ensure(
    manifests.length === 1,
    "必须选择且只能选择一个 .manifest.json 清单，同时选中全部分卷。",
  );
  ensure(
    manifests[0].size <= backupLimits.manifestBytes,
    "清单文件超过8MiB安全限制。",
  );
  const manifestText = await manifests[0].text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    throw new BackupError("清单JSON损坏，未执行恢复。");
  }
  validateManifest(parsed);
  const m = parsed;
  const backupTables=Object.keys(schemasForVersion(m.schemaVersion)) as BackupTable[];
  ensure(
    (options.partNames ? options.partNames.length === m.parts.length + 1 : files.length === m.parts.length + 1),
    "分卷缺失或混入了其他文件，请从文件App选择清单及全部分卷。",
  );
  const byName = new Map(files.map((f) => [f.name, f]));
  const availableNames = options.partNames ?? files.map(f=>f.name);
  ensure(
    new Set(availableNames).size === availableNames.length && m.parts.every((p) => availableNames.includes(p.name)),
    "存在重名或缺失分卷，请重新选择。",
  );
  let key: CryptoKey | undefined;
    let integrityKey: CryptoKey | undefined;
  if (m.encryption) {
    key = await deriveKey(options.password || "", unbase64(m.encryption.salt));
    integrityKey = await deriveIntegrityKey(options.password || "", unbase64(m.encryption.salt));
    checkAbort(signal);
    try {
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: unbase64(m.encryption.authNonce) as BufferSource,
          additionalData: manifestAuthBytes(m) as BufferSource,
        },
        key,
        unbase64(m.encryption.authTag!) as BufferSource,
      );
    } catch {
      throw new BackupError("密码错误或加密清单损坏，未执行恢复。");
    }
  }
  let candidate: Dexie | undefined;
  try {
    candidate = await temporary(
      options.mode === "rehearse" ? "candidate" : "validation", m.schemaVersion,
    );
    const target = candidate;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "",
      records = 0,
      bytes = 0,
      previousTable = -1,
      previousKey = "";
    const counts = Object.fromEntries(
      backupTables.map((t) => [t, 0]),
    ) as Record<BackupTable, number>;
    const parseLine = async (line: string) => {
      checkAbort(signal);
      ensure(
        utf8(line).length <= backupLimits.recordBytes,
        "单条记录过大，恢复已停止。",
      );
      let tuple: any;
      try {
        tuple = JSON.parse(line);
      } catch {
        throw new BackupError("分卷中的记录JSON损坏。");
      }
      ensure(
        Array.isArray(tuple) &&
          tuple.length === 2 &&
          backupTables.includes(tuple[0]),
        "记录表名或编码无效。",
      );
      const table = tuple[0] as BackupTable;
      const order = backupTables.indexOf(table);
      const row = decodeValue(tuple[1]);
      ensure(
        row && typeof row === "object" && !Array.isArray(row),
        "记录不是对象。",
      );
      const id = row[table === "apiCredentials" ? "configId" : "id"];
      ensure(
        typeof id === "string" &&
          id.length > 0 &&
          id.length < 4096 &&
          order >= previousTable,
        "主键或记录顺序无效。",
      );
      ensure(
        order !== previousTable || id > previousKey,
        "主键重复或记录顺序错误。",
      );
      ensure(
        !(table === "apiCredentials" && m.credentials === "excluded"),
        "明文备份包含未授权的凭据记录。",
      );
      if (table === "apiConfigs" && m.credentials === "excluded") {
        ensure(
          !Object.keys(row).some((k) =>
            /^(api.?key|key|token|access.?token|authorization|password|secret)$/i.test(
              k,
            ),
          ),
          "明文API配置中包含未授权凭据字段。",
        );
        if (row.baseUrl) {
          let url: URL;
          try {
            url = new URL(row.baseUrl);
          } catch {
            throw new BackupError("明文API地址未经安全脱敏。");
          }
          ensure(
            !url.username && !url.password && !url.search && !url.hash,
            "明文API地址包含未授权的敏感部分。",
          );
        }
      }
      previousTable = order;
      previousKey = id;
      counts[table]++;
      records++;
      ensure(
        counts[table] <= m.tables[table].count &&
          records <= backupLimits.maxRecords,
        "记录数量超出清单。",
      );
      // This instance is always a newly generated isolated DB, never claudia-phone.
      await target.table(table).add(row);
    };
    for (const p of m.parts) {
      checkAbort(signal);
      const file = options.loadPart ? await options.loadPart(p.name) : byName.get(p.name)!;
      ensure(
        file.size === p.bytes && file.size <= backupLimits.partBytes + 16,
        "分卷大小不符或超过安全限制。",
      );
      let data = new Uint8Array(await file.arrayBuffer());
      ensure(
        (await sha(data)) === p.digest,
        "分卷摘要不符，文件已损坏或被修改。",
      );
      if (key) {
        try {
          data = new Uint8Array(
            await crypto.subtle.decrypt(
              {
                name: "AES-GCM",
                iv: unbase64(p.nonce!) as BufferSource,
                additionalData: partAAD(m, p.index) as BufferSource,
              },
              key,
              data as BufferSource,
            ),
          );
        } catch {
          throw new BackupError("密码错误或加密分卷损坏。");
        }
      }
      try {
        pending += decoder.decode(data, { stream: true });
      } catch {
        throw new BackupError("分卷文本编码损坏。");
      }
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        ensure(line.length > 0, "出现空记录。");
        await parseLine(line);
      }
      ensure(
        pending.length <= backupLimits.recordBytes,
        "单条记录超过安全工作集。",
      );
      bytes += file.size;
      options.onProgress?.({
        phase: options.mode === "rehearse" ? "写入隔离候选库" : "校验文件",
        records,
        bytes,
      });
    }
    try {
      pending += decoder.decode();
    } catch {
      throw new BackupError("分卷文本末尾损坏。");
    }
    ensure(pending.length === 0, "最后一条记录不完整。");
    // Re-read persisted records, not the in-memory parser input.
    for (const table of backupTables) {
      checkAbort(signal);
      ensure(
        counts[table] === m.tables[table].count &&
          (await target.table(table).count()) === counts[table],
        "表记录数量与清单不一致。",
      );
      let digest = await tableSeed(table);
      await eachBackupRow(
        target,
        table,
        async (row) => {
          digest = await nextDigest(digest, await rowBytes(table, row));
        },
        signal,
      );
      ensure(
        (await protectDigest(digest, integrityKey)) === m.tables[table].digest,
        "候选数据库读回摘要不一致，不能报告恢复成功。",
      );
    }
    for (const r of m.resources) {
      checkAbort(signal);
      const asset = await target.table("assets").get(r.id);
      ensure(asset && typeof asset.data === "string", "图片资源缺失。");
      const data = utf8(asset.data);
      ensure(
        data.length === r.bytes && (await protectDigest(await sha(data), integrityKey)) === r.digest,
        "图片资源内容或摘要不一致。",
      );
      ensure(
        /^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(
          asset.data,
        ),
        "图片数据URL不受支持或损坏；不会绕过SVG限制。",
      );
    }
    options.onProgress?.({ phase: "校验主键及引用关系", records, bytes });
    const warnings = await validateReferences(target, m, signal);
    if(m.schemaVersion>=6)await validateTimelineDatabase(target);
    const report: IntegrityReport = {
      status: options.mode === "rehearse" ? "rehearsed" : "verified",
      formatVersion: m.version,
      sourceOrigin: m.sourceOrigin,
      identities: Object.keys((await target.table("themes").get("global"))?.userIdentities??{}).length,
      dailyVisibleCharacters: await target.table("characters").filter(c=>!c.dailyFriendship||c.dailyFriendship.status==="friend").count(),
      backupId: m.backupId,
      snapshotCompletedAt: m.snapshotCompletedAt,
      manifestDigest: await sha(utf8(manifestText)),
      ...(options.mode === "rehearse" ? { candidateName: target.name } : {}),
      schemaVersion: m.schemaVersion,
      counts,
      totalRecords: records,
      parts: m.parts.length,
      resources: m.resources.length,
      warnings,
      credentials: m.credentials,
      redactedConfigs: m.redactions.length,
      recordDigestsMatch: true,
      referencesValid: true,
      sourceDatabaseWritten: false,
    };
    checkAbort(signal);
    if (options.mode === "verify") {
      await discard(target);
      candidate = undefined;
    }
    const result: ReadbackResult = {
      report,
      dispose: () => owned.has(target.name) ? discard(target) : Promise.resolve(),
    };
    if(options.mode === "rehearse") candidates.set(result, target);
    return result;
  } catch (error) {
    if (candidate && owned.has(candidate.name))
      await discard(candidate).catch(() => {});
    checkAbort(signal);
    throw error;
  }
}
export async function validateReferences(
  d: Dexie,
  m: BackupManifest,
  signal?: AbortSignal,
) {
  await validateStoryDatabase(d);
  const errors = new Map<string, number>(),
    warnings = new Set<string>();
  const bad = (code: string) => errors.set(code, (errors.get(code) || 0) + 1);
  const exists = async (table: BackupTable, id: unknown) =>
    typeof id === "string" && !!(await d.table(table).get(id));
  const optional = async (table: BackupTable, id: unknown, code: string) => {
    if (id !== undefined && id !== "" && !(await exists(table, id))) bad(code);
  };
  await eachBackupRow(d,"worlds",async x=>{
    if(x.storyDocument!==undefined){try{await verifyDocumentSnapshot(x.storyDocument);}catch{bad('worlds.storyDocument');}}
    if(x.storyPreferences!==undefined){try{validateStoryPreferences(x.storyPreferences);}catch{bad('worlds.storyPreferences');}}
    if(x.script!==undefined){try{validateScriptConfig(x.script);}catch{bad("worlds.script");}}
  },signal);
  await eachBackupRow(
    d,
    "items",
    async (x) => {
      if (!(await exists("pages", x.pageId))) bad("items.pageId");
      await optional("assets", x.icon, "items.icon");
    },
    signal,
  );
  await eachBackupRow(
    d,
    "themes",
    async (x) => {
      await optional("assets", x.wallpaper, "themes.wallpaper");
      if(x.chatMessageBanners!==undefined&&typeof x.chatMessageBanners!=='boolean')bad('themes.chatMessageBanners');
      if(x.phaseChatLink!==undefined&&!validPhaseChatSettings(x.phaseChatLink))bad('themes.phaseChatLink');
      if(x.chatHub!==undefined){try{validateChatHub(x.chatHub);for(const id of hubAssetIds(x.chatHub))await optional("assets",id,"themes.chatHub.images");}catch{bad("themes.chatHub");}}
      try{validateThemeAppearance(x);}catch{bad("themes.appearance");}
      if (x.userIdentities !== undefined) {
        if (!x.userIdentities || typeof x.userIdentities !== "object" || Array.isArray(x.userIdentities)) bad("themes.userIdentities");
        else for (const identity of Object.values(x.userIdentities)) {
          if (!identity || typeof identity !== "object" || Array.isArray(identity)) bad("themes.userIdentities.profile");
          else await optional("assets", (identity as Record<string, unknown>).avatar, "themes.userIdentities.avatar");
        }
      }
      if (x.worldId && !(await exists("worlds", x.worldId)))
        warnings.add("存在遗留主题worldId，不会据此分配空间。");
    },
    signal,
  );
  await eachBackupRow(
    d,
    "characters",
    async (x) => {
      await optional("assets", x.avatar, "characters.avatar");
      if(x.dailyFriendship !== undefined && !validFriendship(x.dailyFriendship)) bad("characters.dailyFriendship");
      if (x.apiConfigId && !(await exists("apiConfigs", x.apiConfigId)))
        warnings.add("存在已失效角色API引用，需恢复后手动选择。");
      if (x.worldId && !(await exists("worlds", x.worldId)))
        warnings.add("存在遗留角色worldId，原样保留。");
    },
    signal,
  );
  await eachBackupRow(
    d,
    "worldProfiles",
    async (x) => {
      if (
        !(await exists("worlds", x.worldId)) ||
        !(await exists("characters", x.characterId))
      )
        bad("worldProfiles.parents");
      if(x.scriptOrder!==undefined&&(!Number.isInteger(x.scriptOrder)||x.scriptOrder<0||x.scriptOrder>29))bad("worldProfiles.scriptOrder");
    },
    signal,
  );
  await eachBackupRow(
    d,
    "conversations",
    async (x) => {
      if (!(await exists("characters", x.characterId)))
        bad("conversations.characterId");
      if (
        !(x.mode === "daily" || x.mode === "world") ||
        (x.mode === "world" && !(await exists("worlds", x.worldId))) ||
        (x.mode === "daily" && x.worldId)
      )
        bad("conversations.mode/worldId");
      if (
        x.scopeKey !==
        JSON.stringify([
          x.characterId,
          x.mode,
          x.mode === "world" ? x.worldId : "",
        ])
      )
        bad("conversations.scopeKey");
      if (x.apiConfigId && !(await exists("apiConfigs", x.apiConfigId)))
        warnings.add("存在已删除的会话API引用；不会自动改配。");
      if (x.chatSettings && typeof x.chatSettings === "object" && x.chatSettings.background?.kind === "image")
        await optional("assets", x.chatSettings.background.assetId, "conversations.chatSettings.background");
      if (x.sendingToken)
        warnings.add("备份含历史生成锁字段；候选库不运行应用或发出模型请求。");
    },
    signal,
  );
  await eachBackupRow(d,'conversations',async x=>{
    if(x.chatEventReceipts!==undefined&&!validChatEventReceipts(x.chatEventReceipts))bad('conversations.chatEventReceipts');
    try{await validateMemoryStore(d,x);}catch{bad('conversations.memoryStore');}
    if(x.imageDrafts!==undefined){
      if(!x.imageDrafts||typeof x.imageDrafts!=='object'||Array.isArray(x.imageDrafts)){bad('imageDrafts.shape');return;}
      for(const draft of Object.values(x.imageDrafts) as any[]){
        if(!draft||!Array.isArray(draft.assetIds)||typeof draft.text!=='string'||draft.text.length>8000||!Number.isInteger(draft.epoch)){bad('imageDrafts.shape');continue;}
        try{await attachmentImages(d,{attachments:draft.assetIds.map((assetId:string)=>({assetId}))});}catch{bad('imageDrafts.assets');}
      }
    }
  },signal);
  const message = async (
    x: any,
    lookup: (id: string) => Promise<any>,
    scope?: string,
  ) => {
    checkAbort(signal);
    if (
      !x ||
      typeof x.id !== "string" ||
      typeof x.content !== "string" ||
      !["user", "assistant", "system", "tool"].includes(x.role) ||
      (scope && x.conversationId !== scope) ||
      !(await exists("conversations", x.conversationId))
    ) {
      bad("messages.shape/parent");
      return;
    }
    if(x.replyInterruption!==undefined&&(x.role!=="assistant"||!validInterruption(x.replyInterruption)))bad("messages.replyInterruption");
    try{validateBubbleDeletion(x);await validateQuoteReference(d,x);}catch{bad("messages.bubbles/quote");}
    try{await attachmentImages(d,x);}catch{bad("messages.attachments");}
    if (x.activeVariantId) {
      const v = await lookup(x.activeVariantId);
      if (!v || v.messageId !== x.id || v.conversationId !== x.conversationId)
        bad("messages.activeVariantId");
    }
  };
  await eachBackupRow(
    d,
    "messages",
    (x) => message(x, (id) => d.table("messageVariants").get(id)),
    signal,
  );
  await eachBackupRow(
    d,
    "messageVariants",
    async (x) => {
      const p = await d.table("messages").get(x.messageId);
      if (
        !p ||
        p.role !== "assistant" ||
        p.conversationId !== x.conversationId ||
        typeof x.content !== "string"
      )
        bad("messageVariants.parent");
      if(x.replyInterruption!==undefined&&!validInterruption(x.replyInterruption))bad("messageVariants.replyInterruption");
    },
    signal,
  );
  await eachBackupRow(
    d,
    "messageRevisions",
    async (x) => {
      const p = await d.table("messages").get(x.messageId);
      const v = x.variantId
        ? await d.table("messageVariants").get(x.variantId)
        : undefined;
      if (
        !p ||
        p.conversationId !== x.conversationId ||
        typeof x.content !== "string" ||
        (x.variantId &&
          (!v ||
            v.messageId !== x.messageId ||
            v.conversationId !== x.conversationId))
      )
        bad("messageRevisions.parent");
    },
    signal,
  );
  await eachBackupRow(
    d,
    "conversationSnapshots",
    async (x) => {
      if (
        !(await exists("conversations", x.conversationId)) ||
        !Array.isArray(x.messages) ||
        !Array.isArray(x.variants)
      ) {
        bad("snapshots.shape/parent");
        return;
      }
      const messages = new Map(x.messages.map((v: any) => [v.id, v]));
      const variants = new Map<string, any>(
        x.variants.map((v: any) => [v.id, v]),
      );
      if (
        messages.size !== x.messages.length ||
        variants.size !== x.variants.length
      )
        bad("snapshots.duplicateId");
      for (const row of x.messages)
        await message(row, async (id) => variants.get(id), x.conversationId);
      for (const v of x.variants)
        if (
          !messages.has(v.messageId) ||
          v.conversationId !== x.conversationId ||
          typeof v.content !== "string"
        )
          bad("snapshots.variantParent");
    },
    signal,
  );
  await eachBackupRow(
    d,
    "lorebooks",
    async (x) => {
      if (!Array.isArray(x.worldIds)) bad("lorebooks.worldIds");
      else
        for (const id of x.worldIds)
          if (!(await exists("worlds", id)))
            warnings.add("世界书保留已删除世界的绑定ID，不会复活或重绑世界。");
    },
    signal,
  );
  await eachBackupRow(
    d,
    "loreEntries",
    async (x) => {
      if (!(await exists("lorebooks", x.lorebookId)))
        bad("loreEntries.lorebookId");
    },
    signal,
  );
  await eachBackupRow(
    d,
    "apiCredentials",
    async (x) => {
      if (
        m.credentials === "excluded" ||
        typeof x.apiKey !== "string" ||
        !(await exists("apiConfigs", x.configId))
      )
        bad("apiCredentials.configId");
    },
    signal,
  );
  ensure(
    errors.size === 0,
    `引用校验失败：${[...errors].map(([code, count]) => `${code}（${count}项）`).join("；")}。正式数据库未被覆盖。`,
  );
  if (m.credentials === "excluded")
    warnings.add(
      `独立API Key已排除（源表${m.tables.apiCredentials.sourceCount}条）；导入后可能需要重新输入。`,
    );
  if (m.redactions.length)
    warnings.add(
      `有${m.redactions.length}条API配置被脱敏，导入后必须检查并重新设置。`,
    );
  warnings.add("图片校验为资源清单、数据URL和字节摘要，不等同像素解码诊断。");
  return [...warnings];
}

/**
 * Read-only preflight for failed exports: no ZIP, temporary database, credentials,
 * or chat contents leave the device. Reports approximate serialized bytes by table.
 */
export async function auditBackupDataSize(database: Dexie = phoneDatabase, signal?: AbortSignal) {
  await database.open();
  const tables: Array<{table: string; records: number; bytes: number}> = [];
  let totalBytes = 0;
  for (const table of backupTables) {
    let records = 0, bytes = 0;
    await eachBackupRow(database, table, async row => {
      const encoded = rowBytes(table as BackupTable, row);
      bytes += encoded.length + 1;
      records++;
    }, signal);
    tables.push({table, records, bytes});
    totalBytes += bytes;
  }
  return {totalBytes, tables: tables.sort((a,b)=>b.bytes-a.bytes)};
}

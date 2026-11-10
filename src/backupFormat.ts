import {storySchemas} from './storyTypes';
export const legacyBackupSchemas = {
  worlds: "id,createdAt",
  characters: "id,worldId",
  pages: "id,order",
  items: "id,pageId,position",
  themes: "id,worldId",
  assets: "id,type",
  apiConfigs: "id,provider",
  apiCredentials: "configId",
  conversations: "id,&scopeKey,characterId,worldId,updatedAt",
  messages: "id,conversationId,[conversationId+createdAt]",
  worldProfiles: "id,&[worldId+characterId],worldId,characterId",
  lorebooks: "id,updatedAt",
  loreEntries: "id,lorebookId",
  messageVariants: "id,messageId,conversationId",
  messageRevisions: "id,messageId,conversationId,variantId",
  conversationSnapshots: "id,conversationId,createdAt",
} as const;
export const v6BackupSchemas = {...legacyBackupSchemas, timelines:"id,conversationId,parentTimelineId",pathNodes:"id,conversationId,[conversationId+parentNodeId+fingerprint]"} as const;
export const backupSchemas = {...v6BackupSchemas,...storySchemas} as const;
export const schemasForVersion=(version:5|6|7)=>version===5?legacyBackupSchemas:version===6?v6BackupSchemas:backupSchemas;
export type BackupTable = keyof typeof backupSchemas;
export const backupTables = Object.keys(backupSchemas) as BackupTable[];
export const backupLimits = {
  partBytes: 4 * 1024 * 1024,
  recordBytes: 16 * 1024 * 1024,
  manifestBytes: 8 * 1024 * 1024,
  maxParts: 4096,
  maxRecords: 500000,
  depth: 64,
};
export class BackupError extends Error {constructor(message:string,readonly code='CHECK'){super(message);this.name='BackupError';}}
export type BackupPhase='operation'|'export-read'|'export-validate'|'export-temp'|'export-encode'|'export-encrypt'|'export-stage'|'export-cleanup'|'zip-pack'|'zip-read'|'zip-verify'|'download'|'share'|'restore-preview'|'restore-write';
const phaseLabels:Record<BackupPhase,string>={operation:'备份操作','export-read':'读取备份数据','export-validate':'校验聊天时间线','export-temp':'创建临时分卷','export-encode':'编码及校验数据','export-encrypt':'加密备份数据','export-stage':'写入临时分卷','export-cleanup':'清理本次临时分卷','zip-pack':'打包 ZIP','zip-read':'读取 ZIP','zip-verify':'校验备份内容',download:'准备下载文件',share:'保存或分享文件','restore-preview':'生成恢复预览','restore-write':'提交恢复'};
const knownNames=new Set(['TimelineValidationError','BackupError','QuotaExceededError','TransactionInactiveError','PrematureCommitError','DatabaseClosedError','OpenFailedError','TimeoutError','AbortError','NotReadableError','SecurityError','NotAllowedError','DataCloneError','InvalidStateError','UnknownError','OperationError','NotSupportedError','TypeError','RangeError','Error']);
export interface BackupDiagnostic {phase:BackupPhase;code:string;errorType:string}
export class BackupFailure extends BackupError {constructor(message:string,readonly diagnostic:BackupDiagnostic){super(message,diagnostic.code);}}
export function backupDiagnostic(error:unknown,phase:BackupPhase='operation'):BackupDiagnostic {
 if(error instanceof BackupFailure)return error.diagnostic;
 let value=error as {name?:unknown;inner?:unknown};let name=typeof value?.name==='string'&&knownNames.has(value.name)?value.name:'Error';
 for(let i=0;i<2&&value?.inner;i++){value=value.inner as typeof value;if(typeof value?.name==='string'&&knownNames.has(value.name)&&value.name!=='Error')name=value.name;}
 const kind=error instanceof BackupError?error.code:name==='TimelineValidationError'?'INTEGRITY':name==='QuotaExceededError'?'QUOTA':name==='AbortError'?'CANCELLED':name==='TimeoutError'?'TIMEOUT':name==='TransactionInactiveError'||name==='PrematureCommitError'?'TRANSACTION':name==='DatabaseClosedError'||name==='OpenFailedError'?'DATABASE':name==='NotReadableError'?'FILE_READ':name==='SecurityError'||name==='NotAllowedError'?'PERMISSION':name==='OperationError'?'CRYPTO':name==='RangeError'?'RESOURCE':name==='DataCloneError'?'CLONE':'UNKNOWN';
 return {phase,code:'BACKUP_'+kind,errorType:name};
}
export function withBackupPhase(error:unknown,phase:BackupPhase){return error instanceof BackupFailure?error:new BackupFailure(publicBackupError(error,phase),backupDiagnostic(error,phase));}
export function ensure(ok: unknown, message: string): asserts ok {
  if (!ok) throw new BackupError(message);
}
export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new BackupError(
      "操作已取消或页面已进入后台，正式数据未被删除。请保持前台后重试。", "CANCELLED",
    );
}
export function publicBackupError(error:unknown,phase:BackupPhase='operation') {
 if(error instanceof BackupFailure)return error.message;
 const d=backupDiagnostic(error,phase);let message:string;
 if(error instanceof BackupError)message=error.message;
 else {
  const exportPhase=phase.startsWith('export-')||phase==='zip-pack';
  const context=phase==='export-cleanup'?'ZIP 已生成，但本次临时分卷清理未完成，可能占用额外本地空间。':exportPhase?'导出未完成，未生成有效 ZIP；正式数据库未执行恢复或清理。':phase==='download'?'ZIP 已生成，但下载准备未完成。':phase==='share'?(d.code==='BACKUP_CANCELLED'?'已取消保存或分享。备份文件仍保留在当前页面。':'备份文件仍保留在当前页面，系统保存未完成。'):phase.startsWith('restore-')?'恢复尚未提交，当前数据保留。':'读取或验证未完成，当前数据未被覆盖。';
  const reason=d.code==='BACKUP_INTEGRITY'?'聊天时间线一致性校验未通过；未修补、删除或重排任何历史。':d.code==='BACKUP_QUOTA'?'本地存储空间不足，请释放设备空间后主动重试。':d.code==='BACKUP_TRANSACTION'?'数据库事务提前结束，请保持页面前台并关闭其他客户端后主动重试。':d.code==='BACKUP_DATABASE'?'本地数据库当前不可读取，请重新打开页面后主动重试。':d.code==='BACKUP_TIMEOUT'?'处理超时，请保持页面前台；不会自动重试。':d.code==='BACKUP_CANCELLED'?'操作已取消或被浏览器中断。':d.code==='BACKUP_FILE_READ'?'浏览器无法读取所选文件，请先将文件完整保存到本机后重新选择。':d.code==='BACKUP_PERMISSION'?'浏览器未允许本阶段所需的本地存储或文件操作。':d.code==='BACKUP_CRYPTO'?'浏览器的加密或摘要操作失败，不能据此认定密码错误。':d.code==='BACKUP_RESOURCE'?'数据处理超出浏览器可用范围，尚不能确认是否为内存限制。':d.code==='BACKUP_CLONE'?'浏览器无法复制本地数据或临时分卷。':'暂时无法确定失败原因。';
  message=context+reason;
 }
 return message+`（阶段：${phaseLabels[d.phase]}；代码：${d.code}；类型：${d.errorType}）`;
}
export function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 16384)
    s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s);
}
export function unbase64(s: string) {
  ensure(
    typeof s === "string" && s.length <= backupLimits.recordBytes * 2,
    "编码数据过大或无效。",
  );
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    throw new BackupError("编码数据无效。");
  }
}
export async function sha(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export const utf8 = (s: string) => new TextEncoder().encode(s);
export const tableSeed = (name: string) =>
  sha(utf8(`claudia-backup-v1:${name}`));
export async function nextDigest(previous: string, record: Uint8Array) {
  return sha(utf8(previous + ":" + (await sha(record))));
}
// Every object is tagged, so user keys cannot collide with codec metadata.
export async function encodeValue(
  value: unknown,
  depth = 0,
  path = new Set<object>(),
): Promise<unknown> {
  ensure(
    depth <= backupLimits.depth,
    "记录嵌套过深，无法安全备份；未省略该记录。",
  );
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "string") {
    ensure(
      value.length <= backupLimits.recordBytes,
      "单条文本超过安全工作集，备份未完成。",
    );
    return ["string", value];
  }
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number")
    return [
      "number",
      Object.is(value, -0)
        ? "-0"
        : Number.isFinite(value)
          ? value
          : String(value),
    ];
  if (typeof value === "bigint") return ["bigint", String(value)];
  ensure(
    typeof value === "object",
    "记录包含不支持的类型，备份已停止而非静默丢弃。",
  );
  ensure(
    !path.has(value),
    "记录包含循环引用，当前备份格式无法安全处理；请勿升级。",
  );
  path.add(value);
  try {
    if (value instanceof Date) {
      ensure(Number.isFinite(value.getTime()), "记录包含无效日期。");
      return ["date", value.toISOString()];
    }
    if (value instanceof File) {
      ensure(
        value.size <= backupLimits.recordBytes / 2,
        "单个文件记录过大，备份已停止。",
      );
      return [
        "file",
        {
          name: value.name,
          type: value.type,
          lastModified: value.lastModified,
        },
        base64(new Uint8Array(await value.arrayBuffer())),
      ];
    }
    if (value instanceof Blob) {
      ensure(
        value.size <= backupLimits.recordBytes / 2,
        "单个二进制记录过大，当前设备备份已停止。",
      );
      return [
        "blob",
        value.type,
        base64(new Uint8Array(await value.arrayBuffer())),
      ];
    }
    if (value instanceof ArrayBuffer) {
      ensure(
        value.byteLength <= backupLimits.recordBytes / 2,
        "二进制记录过大。",
      );
      return ["buffer", base64(new Uint8Array(value))];
    }
    if (value instanceof Uint8Array) {
      ensure(
        value.byteLength <= backupLimits.recordBytes / 2,
        "二进制记录过大。",
      );
      return ["uint8", base64(value)];
    }
    if (Array.isArray(value)) {
      ensure(value.length <= backupLimits.maxRecords, "单条数组超过安全范围。");
      const entries: unknown[] = [];
      for (let i = 0; i < value.length; i++)
        entries.push(
          i in value ? await encodeValue(value[i], depth + 1, path) : ["hole"],
        );
      return ["array", entries];
    }
    ensure(
      Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null,
      "记录类型尚未支持，备份已停止而非转换或丢弃。",
    );
    const entries: unknown[] = [];
    for (const key of Object.keys(value).sort())
      entries.push([
        key,
        await encodeValue(
          (value as Record<string, unknown>)[key],
          depth + 1,
          path,
        ),
      ]);
    return ["object", Object.getPrototypeOf(value) === null, entries];
  } finally {
    path.delete(value);
  }
}
export function decodeValue(input: any, depth = 0): any {
  ensure(
    depth <= backupLimits.depth && Array.isArray(input),
    "备份记录编码无效。",
  );
  const [tag, v, extra] = input;
  switch (tag) {
    case "null":
      return null;
    case "undefined":
      return undefined;
    case "string":
      ensure(typeof v === "string", "文本编码无效。");
      return v;
    case "boolean":
      ensure(typeof v === "boolean", "布尔编码无效。");
      return v;
    case "number":
      ensure(
        typeof v === "number" ||
          ["NaN", "Infinity", "-Infinity", "-0"].includes(v),
        "数字编码无效。",
      );
      return v === "-0" ? -0 : Number(v);
    case "bigint":
      ensure(
        typeof v === "string" && /^-?\d{1,10000}$/.test(v),
        "整数编码无效。",
      );
      return BigInt(v);
    case "date": {
      const d = new Date(v);
      ensure(
        typeof v === "string" && Number.isFinite(d.getTime()),
        "日期编码无效。",
      );
      return d;
    }
    case "buffer":
      return unbase64(v).buffer;
    case "uint8":
      return unbase64(v);
    case "file":
      ensure(
        v &&
          typeof v.name === "string" &&
          typeof v.type === "string" &&
          Number.isFinite(v.lastModified) &&
          typeof extra === "string",
        "文件编码无效。",
      );
      return new File([unbase64(extra) as BlobPart], v.name, {
        type: v.type,
        lastModified: v.lastModified,
      });
    case "blob":
      ensure(
        typeof v === "string" && typeof extra === "string",
        "二进制编码无效。",
      );
      return new Blob([unbase64(extra) as BlobPart], { type: v });
    case "array": {
      ensure(Array.isArray(v), "数组编码无效。");
      const a = new Array(v.length);
      v.forEach((x, i) => {
        if (!(Array.isArray(x) && x[0] === "hole"))
          a[i] = decodeValue(x, depth + 1);
      });
      return a;
    }
    case "object": {
      ensure(typeof v === "boolean" && Array.isArray(extra), "对象编码无效。");
      const o = v ? Object.create(null) : {};
      const seen = new Set<string>();
      for (const pair of extra) {
        ensure(
          Array.isArray(pair) &&
            typeof pair[0] === "string" &&
            !seen.has(pair[0]),
          "对象字段重复或无效。",
        );
        seen.add(pair[0]);
        Object.defineProperty(o, pair[0], {
          value: decodeValue(pair[1], depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return o;
    }
    default:
      throw new BackupError("未知记录编码版本。");
  }
}
export async function rowBytes(table: BackupTable, row: unknown) {
  return utf8(JSON.stringify([table, await encodeValue(row)]));
}
export interface BackupManifest {
  sourceOrigin?: string;
  format: "claudia-phone-backup";
  version: 1 | 2 | 3;
  codec: 1;
  backupId: string;
  schemaVersion: 5 | 6 | 7;
  nativeVersion: 50 | 60 | 70;
  createdAt: string;
  snapshotCompletedAt: string;
  coordination: string;
  tables: Record<
    BackupTable,
    { schema: string; sourceCount: number; count: number; digest: string }
  >;
  resources: { id: string; bytes: number; digest: string }[];
  parts: {
    index: number;
    name: string;
    bytes: number;
    digest: string;
    nonce?: string;
  }[];
  credentials: "excluded" | "encrypted";
  redactions: { record: string; fields: string[] }[];
  encryption?: {
    algorithm: "AES-GCM";
    integrity: "HMAC-SHA256";
    kdf: "PBKDF2-SHA256";
    iterations: 600000;
    salt: string;
    authNonce: string;
    authTag?: string;
  };
}
export async function deriveKey(password: string, salt: Uint8Array) {
  ensure(
    password.length >= 12 && password.length <= 1024,
    "加密密码需12–1024个字符，请勿使用API Key作密码。",
  );
  const material = await crypto.subtle.importKey(
    "raw",
    utf8(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 600000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export function manifestAuthBytes(m: BackupManifest) {
  const copy = structuredClone(m);
  if (copy.encryption) delete copy.encryption.authTag;
  return utf8(JSON.stringify(copy));
}
export function partAAD(m: Pick<BackupManifest, "backupId">, index: number) {
  return utf8(`claudia-phone-backup:1:${m.backupId}:${index}`);
}

export async function deriveIntegrityKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", utf8(password) as BufferSource, "PBKDF2", false, ["deriveKey"]);
  const context = utf8("claudia-backup-integrity-v1");
  const contextualSalt = new Uint8Array(salt.length + context.length);
  contextualSalt.set(salt); contextualSalt.set(context, salt.length);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt:contextualSalt as BufferSource, iterations:600000, hash:"SHA-256"}, material, {name:"HMAC", hash:"SHA-256", length:256}, false, ["sign"]);
}
export async function protectDigest(digest: string, key?: CryptoKey) {
  if (!key) return digest;
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(digest) as BufferSource));
  return Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
}

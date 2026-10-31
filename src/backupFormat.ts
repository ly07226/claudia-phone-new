export const backupSchemas = {
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
export class BackupError extends Error {}
export function ensure(ok: unknown, message: string): asserts ok {
  if (!ok) throw new BackupError(message);
}
export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new BackupError(
      "操作已取消或页面已进入后台，正式数据未被删除。请保持前台后重试。",
    );
}
export function publicBackupError(error: unknown) {
  if (error instanceof BackupError) return error.message;
  if ((error as { name?: string })?.name === "QuotaExceededError")
    return "本地空间不足，操作未完成；正式数据没有被清理，请释放设备空间后重试。";
  return "备份操作未完成：可能是文件损坏、存储不足或浏览器中断。正式数据库未被覆盖。";
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
  format: "claudia-phone-backup";
  version: 1;
  codec: 1;
  backupId: string;
  schemaVersion: 5;
  nativeVersion: 50;
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

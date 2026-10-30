import { db } from "./store";
import {
  loreLimits,
  newBook,
  newEntry,
  type Lorebook,
  type LoreEntry,
  type LorePreview,
} from "./loreTypes";
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
function keys(v: unknown): string[] {
  if (v === undefined) return [];
  if (
    !Array.isArray(v) ||
    v.length > 200 ||
    v.some((k) => typeof k !== "string" || k.length > 200)
  )
    throw Error("关键词必须为最多 200 项的字符串数组，每项不超过 200 字符。");
  return v.map((k) => (k as string).trim()).filter(Boolean);
}
export function validateLore(book: Lorebook, entries: LoreEntry[]) {
  if (
    !book.name.trim() ||
    book.name.length > 120 ||
    book.description.length > 10000
  )
    throw Error("世界书名称必填且不超过 120 字符；描述最多 10000 字符。");
  if (!integer(book.scanDepth, 1, 30) || !integer(book.charBudget, 100, 8000))
    throw Error("扫描深度为 1–30，字符预算为 100–8000。");
  if (entries.length > loreLimits.entries)
    throw Error("单本世界书最多 3000 条。");
  let total = 0;
  for (const e of entries) {
    if (
      typeof e.content !== "string" ||
      e.content.length > loreLimits.contentChars ||
      !e.content.trim() ||
      e.title.length > 200
    )
      throw Error("条目内容必填且最多 20000 字符，名称最多 200 字符。");
    keys(e.primaryKeys);
    keys(e.secondaryKeys);
    if (
      !integer(e.priority, -100000, 100000) ||
      !integer(e.selectiveLogic, 0, 3) ||
      !["before-profile", "after-profile"].includes(e.insertionPosition) ||
      (e.scanDepth !== null && !integer(e.scanDepth, 1, 30))
    )
      throw Error("条目高级参数不合法。");
    total += e.content.length;
    if (total > loreLimits.totalChars)
      throw Error("世界书内容总量最多 200 万字符。");
  }
}
export function parseLorebook(
  text: string,
  fileName = "导入的世界书",
): LorePreview {
  if (new TextEncoder().encode(text).length > loreLimits.fileBytes)
    throw Error("JSON 文件不能超过 5 MB。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Error("无法解析 JSON，请检查文件格式。");
  }
  const root = object(parsed);
  const native = root.format === "claudia-phone-lorebook";
  if (native && root.version !== 1)
    throw Error("不支持此 Claudia Phone 世界书版本。");
  const sourceBook = native ? object(root.lorebook) : root;
  const rawEntries = root.entries;
  if (!rawEntries || typeof rawEntries !== "object")
    throw Error("无法识别世界书：需要 entries 数组或对象。");
  if (native && !Array.isArray(rawEntries))
    throw Error("Native entries 必须为数组。");
  const rows = Array.isArray(rawEntries)
    ? rawEntries
    : Object.values(rawEntries);
  if (rows.length > loreLimits.entries) throw Error("文件条目超过 3000 条。");
  if (
    !native &&
    rows.length > 0 &&
    !rows.some((r) => {
      const o = object(r);
      return (
        typeof o.content === "string" &&
        ("key" in o ||
          "keys" in o ||
          "uid" in o ||
          "comment" in o ||
          "constant" in o)
      );
    })
  )
    throw Error("无法识别的外部 entries 格式。");
  const book = {
    ...newBook(),
    name:
      typeof sourceBook.name === "string"
        ? sourceBook.name
        : fileName.replace(/\.json$/i, ""),
    description:
      typeof sourceBook.description === "string" ? sourceBook.description : "",
    enabled: sourceBook.enabled !== false,
    sourceType: "imported" as const,
    rawMetadata: native
      ? object(sourceBook.rawMetadata)
      : Object.fromEntries(
          Object.entries(sourceBook).filter(([k]) => k !== "entries"),
        ),
  };
  if (native) {
    if (sourceBook.scanDepth !== undefined)
      book.scanDepth = sourceBook.scanDepth as number;
    if (sourceBook.charBudget !== undefined)
      book.charBudget = sourceBook.charBudget as number;
  }
  const warnings: string[] = [];
  const entries: LoreEntry[] = [];
  let invalid = 0;
  const supported = new Set([
    "uid",
    "key",
    "keys",
    "keysecondary",
    "secondary_keys",
    "insertion_order",
    "title",
    "name",
    "comment",
    "content",
    "constant",
    "selective",
    "selectiveLogic",
    "order",
    "position",
    "disable",
    "enabled",
    "probability",
    "useProbability",
    "depth",
    "scanDepth",
    "caseSensitive",
  ]);
  for (let index = 0; index < rows.length; index++) {
    const r = object(rows[index]);
    try {
      let e: LoreEntry;
      if (native) {
        const base = newEntry(book.id);
        e = {
          ...base,
          title: typeof r.title === "string" ? r.title : "",
          content: r.content as string,
          primaryKeys: keys(r.primaryKeys),
          secondaryKeys: keys(r.secondaryKeys),
          enabled: r.enabled !== false,
          constant: r.constant === true,
          selective: r.selective === true,
          selectiveLogic: (r.selectiveLogic ??
            0) as LoreEntry["selectiveLogic"],
          priority: (r.priority ?? 100) as number,
          insertionPosition: (r.insertionPosition ??
            "after-profile") as LoreEntry["insertionPosition"],
          scanDepth: (r.scanDepth ?? null) as number | null,
          caseSensitive: r.caseSensitive === true,
          compatibilityIssues: Array.isArray(r.compatibilityIssues)
            ? r.compatibilityIssues.filter(
                (x): x is string => typeof x === "string",
              )
            : [],
          rawMetadata: object(r.rawMetadata),
        };
      } else {
        e = {
          ...newEntry(book.id),
          title:
            typeof r.comment === "string"
              ? r.comment
              : typeof r.title === "string"
                ? r.title
                : typeof r.name === "string"
                  ? r.name
                  : "",
          content: r.content as string,
          primaryKeys: keys(r.key ?? r.keys),
          secondaryKeys: keys(r.keysecondary ?? r.secondary_keys),
          enabled: r.disable !== true && r.enabled !== false,
          constant: r.constant === true,
          selective: r.selective === true,
          selectiveLogic: (r.selectiveLogic ??
            0) as LoreEntry["selectiveLogic"],
          priority: (r.order ?? r.insertion_order ?? 100) as number,
          caseSensitive: r.caseSensitive === true,
          rawMetadata: r,
        };
        if (
          r.position === undefined ||
          r.position === 1 ||
          r.position === "after_char"
        )
          e.insertionPosition = "after-profile";
        else if (r.position === 0 || r.position === "before_char")
          e.insertionPosition = "before-profile";
        else
          e.compatibilityIssues.push(
            "插入位置不是基础前置/后置位置，暂不执行。",
          );
        if (r.scanDepth !== undefined && r.scanDepth !== null)
          e.scanDepth = r.scanDepth as number;
        if (
          r.depth !== undefined &&
          r.position !== undefined &&
          r.position !== 0 &&
          r.position !== 1 &&
          r.position !== "before_char" &&
          r.position !== "after_char"
        )
          e.compatibilityIssues.push(
            "depth 是外部提示插入深度，不等同扫描消息数，暂不执行。",
          );
        if (
          r.useProbability !== false &&
          r.probability !== undefined &&
          r.probability !== 100
        )
          e.compatibilityIssues.push("概率触发暂不支持。");
        for (const k of Object.keys(r))
          if (!supported.has(k))
            e.compatibilityIssues.push(`未识别字段：${k.slice(0, 80)}`);
        if (
          [...e.primaryKeys, ...e.secondaryKeys].some((k) =>
            /^\/.*\/[a-z]*$/i.test(k),
          )
        )
          e.compatibilityIssues.push("正则关键词暂不支持。");
        if (!integer(e.selectiveLogic, 0, 3)) {
          e.compatibilityIssues.push("未知 selectiveLogic，暂不执行。");
          e.selectiveLogic = 0;
        }
      }
      if (native) {
        const known = new Set([
          "id",
          "lorebookId",
          "title",
          "content",
          "primaryKeys",
          "secondaryKeys",
          "enabled",
          "constant",
          "selective",
          "selectiveLogic",
          "priority",
          "insertionPosition",
          "scanDepth",
          "caseSensitive",
          "createdAt",
          "updatedAt",
          "compatibilityIssues",
          "rawMetadata",
        ]);
        const extra = Object.fromEntries(
          Object.entries(r).filter(([k]) => !known.has(k)),
        );
        if (Object.keys(extra).length) {
          e.compatibilityIssues.push(
            ...Object.keys(extra).map(
              (k) => `未识别 Native 字段：${k.slice(0, 80)}`,
            ),
          );
          e.rawMetadata = { ...e.rawMetadata, unrecognizedNativeFields: extra };
        }
      }
      validateLore(book, [e]);
      entries.push(e);
      if (e.compatibilityIssues.length)
        warnings.push(
          `第 ${index + 1} 条兼容性提示：${e.compatibilityIssues.slice(0, 8).join("；")}`,
        );
    } catch {
      invalid++;
      warnings.push(
        `第 ${index + 1} 条内容或参数无效，将跳过；其他条目不会受影响。`,
      );
    }
  }
  if (invalid) warnings.push(`共 ${invalid} 条无法转换，不会导入。`);
  const issues =
    entries.filter((e) => e.compatibilityIssues.length > 0).length + invalid;
  if (issues)
    warnings.push(
      "该世界书包含 Claudia Phone 当前未完全支持的高级字段，基础内容仍可导入。为避免改变含义，有兼容性问题的条目会保留内容但暂停参与 Prompt，需编辑确认后启用。",
    );
  const knownRoot = new Set(
    native
      ? ["format", "version", "lorebook", "entries"]
      : ["name", "description", "entries", "enabled"],
  );
  const unknown = Object.keys(root).filter((k) => !knownRoot.has(k));
  if (unknown.length) {
    book.rawMetadata = {
      ...book.rawMetadata,
      unrecognizedRootFields: Object.fromEntries(
        unknown.map((k) => [k, root[k]]),
      ),
    };
    warnings.push(
      `世界书未识别字段：${unknown.slice(0, 20).join("、")}（已保留元数据）。`,
    );
  }
  validateLore(book, entries);
  return {
    format: native ? "Claudia Phone" : "SillyTavern / Tavern",
    book,
    entries,
    total: rows.length,
    valid: entries.filter((e) => !e.compatibilityIssues.length).length,
    issues,
    warnings,
  };
}
export async function importLorebook(preview: LorePreview) {
  validateLore(preview.book, preview.entries);
  if (!preview.entries.length && preview.total > 0)
    throw Error("没有可导入条目。");
  const id = crypto.randomUUID();
  const now = Date.now();
  const book = {
    ...preview.book,
    id,
    global: false,
    worldIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction("rw", [db.lorebooks, db.loreEntries], async () => {
    await db.lorebooks.add(book);
    await db.loreEntries.bulkAdd(
      preview.entries.map((e, index) => ({
        ...e,
        id: crypto.randomUUID(),
        lorebookId: id,
        createdAt: now + index,
        updatedAt: now,
      })),
    );
  });
  return book;
}
export function exportLorebook(book: Lorebook, entries: LoreEntry[]) {
  validateLore(book, entries);
  return JSON.stringify(
    {
      format: "claudia-phone-lorebook",
      version: 1,
      lorebook: {
        name: book.name,
        description: book.description,
        enabled: book.enabled,
        sourceType: book.sourceType,
        scanDepth: book.scanDepth,
        charBudget: book.charBudget,
        rawMetadata: book.rawMetadata,
      },
      entries: [...entries]
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            a.createdAt - b.createdAt ||
            a.id.localeCompare(b.id),
        )
        .map(({ id: _, lorebookId: __, ...e }) => e),
    },
    null,
    2,
  );
}

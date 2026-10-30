import { ChevronDown, Plus, Search } from "lucide-react";
import { evaluateRegex, regexError } from "./loreRegex";
import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { db, usePhone } from "./store";
import {
  normalizeEntry,
  newBook,
  newEntry,
  loreLimits,
  type Lorebook,
  type LoreEntry,
  type LorePreview,
} from "./loreTypes";
import {
  parseLorebook,
  importLorebook,
  exportLorebook,
  validateLore,
} from "./loreImport";
const keyText = (keys: string[]) => keys.join("\n");
const keyLines = (s: string, regex = false) =>
  s
    .split(regex ? /\n/ : /\n|,|，/)
    .map((x) => x.trim())
    .filter(Boolean);
function LoreSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className={`lore-switch ${checked ? "is-on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
    >
      <span className="lore-switch-track">
        <span />
      </span>
    </button>
  );
}
function FoldHeader({
  name,
  description,
  meta,
  expanded,
  onToggle,
  switchLabel,
  enabled,
  busy,
  onSwitch,
  id,
  kind,
}: {
  name: string;
  description?: string;
  meta: string;
  expanded: boolean;
  onToggle: () => void;
  switchLabel: string;
  enabled: boolean;
  busy: boolean;
  onSwitch: () => void;
  id: string;
  kind: "世界书" | "条目";
}) {
  return (
    <div className="lore-fold-header" onClick={onToggle}>
      <button
        type="button"
        className="lore-fold-toggle"
        aria-label={`${expanded ? "收起" : "展开"}${kind} ${name}`}
        aria-expanded={expanded}
        aria-controls={id}
      >
        <span className="lore-fold-text">
          <span role="heading" aria-level={3} className="lore-fold-title">
            {name}
          </span>
          {description && (
            <span className="lore-fold-description">{description}</span>
          )}
          <span className="lore-fold-meta">{meta}</span>
        </span>
        <ChevronDown size={18} className={expanded ? "is-open" : ""} />
      </button>
      <LoreSwitch
        label={switchLabel}
        checked={enabled}
        disabled={busy}
        onChange={onSwitch}
      />
    </div>
  );
}
export function Lorebooks() {
  const libraryRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLFormElement>(null);
  const bookEditorRef = useRef<HTMLFormElement>(null);
  const primaryInput = useRef<HTMLTextAreaElement>(null);
  const secondaryInput = useRef<HTMLTextAreaElement>(null);
  const [regexSample, setRegexSample] = useState("");
  const [regexTest, setRegexTest] = useState("");
  const worlds = usePhone((s) => s.worlds);
  const [books, setBooks] = useState<Lorebook[]>([]);
  const selectedId = useRef<string | null>(null);
  const [entryOpen, setEntryOpen] = useState<Set<string>>(new Set());
  const [bookSearch, setBookSearch] = useState("");
  const [bookFilter, setBookFilter] = useState<"all" | "enabled" | "disabled">(
    "all",
  );
  const [bookPage, setBookPage] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<LoreEntry[]>([]);
  const [bookForm, setBookForm] = useState<Lorebook | null>(null);
  const [entryForm, setEntryForm] = useState<LoreEntry | null>(null);
  const [preview, setPreview] = useState<LorePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [exportUrl, setExportUrl] = useState("");
  const reload = async (id?: string) => {
    const rows = (await db.lorebooks.toArray()).sort(
      (a, b) =>
        b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    setBooks(rows);
    if (id && selectedId.current === id) {
      const b = await db.lorebooks.get(id);
      const entries = await db.loreEntries
        .where("lorebookId")
        .equals(id)
        .toArray();
      if (selectedId.current === id) {
        setSelected(b || null);
        setEntries(
          entries
            .map(normalizeEntry)
            .sort(
              (a, b) =>
                b.priority - a.priority ||
                a.createdAt - b.createdAt ||
                a.id.localeCompare(b.id),
            ),
        );
      }
    }
  };
  function closeBook() {
    selectedId.current = null;
    setSelected(null);
    setEntryForm(null);
  }
  async function toggleBook(b: Lorebook) {
    if (busy) return;
    if (selectedId.current === b.id) {
      closeBook();
      return;
    }
    selectedId.current = b.id;
    setSelected(b);
    setEntries([]);
    setEntryForm(null);
    setBookForm(null);
    setPage(0);
    setQuery("");
    await action(() => reload(b.id));
  }
  async function switchBook(b: Lorebook) {
    await action(async () => {
      await db.lorebooks.update(b.id, {
        enabled: !b.enabled,
        updatedAt: Date.now(),
      });
      setBookForm((f) => (f?.id === b.id ? { ...f, enabled: !b.enabled } : f));
      await reload(b.id);
    });
  }
  async function switchEntry(e: LoreEntry) {
    await action(async () => {
      await db.loreEntries.update(e.id, {
        enabled: !e.enabled,
        updatedAt: Date.now(),
      });
      setEntryForm((f) => (f?.id === e.id ? { ...f, enabled: !e.enabled } : f));
      await reload(e.lorebookId);
    });
  }
  const matchingBooks = books.filter(
    (b) =>
      `${b.name} ${b.description}`
        .toLowerCase()
        .includes(bookSearch.trim().toLowerCase()) &&
      (bookFilter === "all" || b.enabled === (bookFilter === "enabled")),
  );
  const visibleBooks = matchingBooks.slice(bookPage * 20, (bookPage + 1) * 20);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      visibleBooks.map(
        async (b) =>
          [
            b.id,
            await db.loreEntries.where("lorebookId").equals(b.id).count(),
          ] as const,
      ),
    )
      .then((rows) => {
        if (!cancelled)
          setCounts((old) => ({ ...old, ...Object.fromEntries(rows) }));
      })
      .catch(() => {
        if (!cancelled) setError("无法读取条目数量，请检查存储。");
      });
    return () => {
      cancelled = true;
    };
  }, [books, bookPage, bookSearch, bookFilter, entries]);
  useEffect(() => {
    const max = Math.max(0, Math.ceil(matchingBooks.length / 20) - 1);
    if (bookPage > max) setBookPage(max);
  }, [matchingBooks.length, bookPage]);
  useLayoutEffect(() => {
    const phone = libraryRef.current?.closest<HTMLElement>(".phone");
    const scroll = libraryRef.current?.closest<HTMLElement>(".app-scroll");
    // Hidden phone containers can retain native focus-scroll offsets from app launching.
    // Reset only on entering this library, never on folding or switching enabled state.
    if (phone) {
      phone.scrollTop = 0;
      phone.scrollLeft = 0;
      phone.classList.add("lore-open");
    }
    if (scroll) {
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
    }
    return () => phone?.classList.remove("lore-open");
  }, []);
  useEffect(() => {
    void reload().catch(() => setError("无法读取世界书，请检查本地存储。"));
  }, []);
  useEffect(
    () => () => {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
    },
    [exportUrl],
  );
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error &&
          /^(世界书|条目|单本|扫描|关键词|JSON|无法|不支持|文件|没有)/.test(
            e.message,
          )
          ? e.message
          : "操作失败，请检查文件内容或浏览器存储空间。",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setExportUrl("");
  }, [selected?.id]);
  useEffect(() => {
    setRegexTest("");
    setRegexSample("");
    if (entryForm)
      editorRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [entryForm?.id]);
  useEffect(() => {
    if (bookForm)
      bookEditorRef.current?.scrollIntoView({
        block: "start",
        behavior: "auto",
      });
  }, [bookForm?.id]);
  const filtered = entries.filter((e) =>
    `${e.title} ${e.primaryKeys.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const expandedContent = selected ? (
    <>
      <div className="lore-book-management">
        <p>{selected.description}</p>
        <p className="hint">
          绑定世界：
          {selected.worldIds.length
            ? selected.worldIds
                .map(
                  (id) =>
                    worlds.find((w) => w.id === id)?.name || "已删除的世界",
                )
                .join("、")
            : "未绑定"}
          {selected.global ? "（全局可用，包含日常）" : ""}
        </p>
        <p>
          {selected.global
            ? "全局可用"
            : `已绑定 ${selected.worldIds.length} 个世界；不进入日常聊天`}{" "}
          · {selected.enabled ? "已启用" : "已停用"} · {entries.length} 条
        </p>
        <div className="api-actions">
          <button
            onClick={() => {
              closeBook();
            }}
          >
            收起世界书
          </button>
          <button disabled={busy} onClick={() => setBookForm({ ...selected })}>
            编辑世界书
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await db.transaction(
                  "rw",
                  [db.lorebooks, db.loreEntries],
                  async () => {
                    const b = await db.lorebooks.get(selected.id);
                    if (!b) throw Error("世界书已不存在。");
                    const rows = await db.loreEntries
                      .where("lorebookId")
                      .equals(b.id)
                      .toArray();
                    const id = crypto.randomUUID();
                    const now = Date.now();
                    await db.lorebooks.add({
                      ...b,
                      id,
                      name: `${b.name}（副本）`.slice(0, 120),
                      enabled: false,
                      createdAt: now,
                      updatedAt: now,
                    });
                    await db.loreEntries.bulkAdd(
                      rows.map((e) => ({
                        ...e,
                        id: crypto.randomUUID(),
                        lorebookId: id,
                      })),
                    );
                  },
                );
                await reload();
              })
            }
          >
            复制世界书
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const b = await db.lorebooks.get(selected.id);
                if (!b) throw Error("世界书已不存在。");
                const rows = await db.loreEntries
                  .where("lorebookId")
                  .equals(b.id)
                  .toArray();
                setExportUrl(
                  URL.createObjectURL(
                    new Blob([exportLorebook(b, rows)], {
                      type: "application/json",
                    }),
                  ),
                );
              })
            }
          >
            导出为 Claudia Phone JSON
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "删除此世界书及其全部条目？不会删除世界、角色或聊天记录。",
                ) &&
                confirm("再次确认永久删除这本世界书和全部条目？")
              )
                void action(async () => {
                  await db.transaction(
                    "rw",
                    [db.lorebooks, db.loreEntries],
                    async () => {
                      await db.loreEntries
                        .where("lorebookId")
                        .equals(selected.id)
                        .delete();
                      await db.lorebooks.delete(selected.id);
                    },
                  );
                  selectedId.current = null;
                  setSelected(null);
                  setEntryForm(null);
                  setBookForm(null);
                  await reload();
                });
            }}
          >
            删除世界书
          </button>
        </div>
        {exportUrl && (
          <a
            className="primary"
            href={exportUrl}
            download="claudia-lorebook.json"
          >
            下载 JSON 文件
          </a>
        )}
      </div>
      <button
        className="primary"
        disabled={busy}
        onClick={() => setEntryForm(newEntry(selected.id))}
      >
        新增条目
      </button>
      {entryForm && (
        <form
          ref={editorRef}
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await db.transaction(
                "rw",
                [db.lorebooks, db.loreEntries],
                async () => {
                  const b = await db.lorebooks.get(entryForm.lorebookId);
                  if (!b) throw Error("世界书已删除。");
                  const rows = await db.loreEntries
                    .where("lorebookId")
                    .equals(b.id)
                    .toArray();
                  validateLore(b, [
                    ...rows.filter((r) => r.id !== entryForm.id),
                    entryForm,
                  ]);
                  await db.loreEntries.put({
                    ...entryForm,
                    updatedAt: Date.now(),
                  });
                  await db.lorebooks.update(b.id, {
                    updatedAt: Date.now(),
                  });
                },
              );
              setEntryForm(null);
              await reload(selected.id);
            });
          }}
        >
          <h3>编辑条目</h3>
          <label>
            条目名称
            <input
              aria-label="条目名称"
              maxLength={200}
              value={entryForm.title}
              onChange={(e) =>
                setEntryForm({ ...entryForm, title: e.target.value })
              }
            />
          </label>
          <label>
            关键词（逗号或换行分隔）
            <textarea
              aria-label="条目关键词"
              ref={primaryInput}
              key={`primary-${entryForm.id}`}
              defaultValue={keyText(entryForm.primaryKeys)}
              onChange={(e) =>
                setEntryForm({
                  ...entryForm,
                  primaryKeys: keyLines(e.target.value, entryForm.regex),
                })
              }
            />
          </label>
          <label className="lore-check">
            <input
              aria-label="使用正则"
              type="checkbox"
              checked={entryForm.regex ?? false}
              onChange={(e) => {
                setRegexTest("");
                setEntryForm({
                  ...entryForm,
                  regex: e.target.checked,
                  primaryKeys: keyLines(
                    primaryInput.current?.value ??
                      keyText(entryForm.primaryKeys),
                    e.target.checked,
                  ),
                  secondaryKeys: keyLines(
                    secondaryInput.current?.value ??
                      keyText(entryForm.secondaryKeys),
                    e.target.checked,
                  ),
                });
              }}
            />
            Regex / 使用正则
          </label>
          {entryForm.regex && (
            <div>
              <p className="hint">
                正则每行一条（不拆逗号），支持裸表达式或
                /pattern/flags。普通模式支持逗号及换行。
              </p>
              {regexError(
                [...entryForm.primaryKeys, ...entryForm.secondaryKeys],
                entryForm.caseSensitive,
              ) && (
                <p role="alert" className="api-error">
                  正则无效：请检查表达式或 flags。
                </p>
              )}
              <label>
                正则测试文本
                <textarea
                  aria-label="正则测试文本"
                  value={regexSample}
                  onChange={(e) => setRegexSample(e.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={async () => {
                  const issue = regexError(
                    [...entryForm.primaryKeys, ...entryForm.secondaryKeys],
                    entryForm.caseSensitive,
                  );
                  if (issue) {
                    setRegexTest(issue);
                    return;
                  }
                  setRegexTest("测试中…");
                  const result = await evaluateRegex([
                    {
                      id: "test",
                      text: regexSample,
                      primary: entryForm.primaryKeys,
                      secondary: entryForm.secondaryKeys,
                      caseSensitive: entryForm.caseSensitive,
                    },
                  ]);
                  setRegexTest(
                    result.test?.error ||
                      `主关键词命中：${result.test.primary.some(Boolean) ? "是" : "否"}；辅助命中：${result.test.secondary.filter(Boolean).length}`,
                  );
                }}
              >
                测试正则
              </button>
              <p role="status">{regexTest}</p>
            </div>
          )}
          <label>
            内容
            <textarea
              aria-label="条目内容"
              required
              maxLength={20000}
              className="lore-content-editor"
              value={entryForm.content}
              onChange={(e) =>
                setEntryForm({ ...entryForm, content: e.target.value })
              }
            />
          </label>
          <label>
            激活方式
            <select
              aria-label="条目激活方式"
              value={entryForm.constant ? "constant" : "keyword"}
              onChange={(e) =>
                setEntryForm({
                  ...entryForm,
                  constant: e.target.value === "constant",
                })
              }
            >
              <option value="keyword">关键词触发</option>
              <option value="constant">常驻 / Always Active</option>
            </select>
          </label>
          <label className="lore-check">
            <input
              type="checkbox"
              checked={entryForm.enabled}
              onChange={(e) =>
                setEntryForm({ ...entryForm, enabled: e.target.checked })
              }
            />
            启用条目
          </label>
          <label>
            优先级（越大越先）
            <input
              aria-label="条目优先级"
              type="number"
              min={-100000}
              max={100000}
              value={entryForm.priority}
              onChange={(e) =>
                setEntryForm({
                  ...entryForm,
                  priority: e.target.valueAsNumber,
                })
              }
            />
          </label>
          <label>
            插入位置
            <select
              aria-label="条目插入位置"
              value={entryForm.insertionPosition}
              onChange={(e) =>
                setEntryForm({
                  ...entryForm,
                  insertionPosition: e.target
                    .value as LoreEntry["insertionPosition"],
                })
              }
            >
              <option value="before-profile">
                Before Character / 角色基础资料前
              </option>
              <option value="after-profile">
                After Character / 角色基础资料后
              </option>
              <option value="before-conversation">
                Before Conversation / 聊天记录前
              </option>
              <option value="after-conversation">
                After Conversation / 聊天记录后
              </option>
              <option value="at-depth">At Depth / 按深度插入</option>
            </select>
          </label>
          {entryForm.insertionPosition === "at-depth" && (
            <label>
              注入深度 Depth
              <input
                aria-label="注入深度 Depth"
                type="number"
                min={0}
                max={30}
                value={entryForm.insertionDepth ?? 0}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    insertionDepth: e.target.valueAsNumber,
                  })
                }
              />
              <span className="hint">
                0 = 聊天末尾；1 =
                最后一条历史消息之前。超出历史长度时插入记录前。
              </span>
            </label>
          )}
          <label>
            Role / 消息角色
            <select
              aria-label="条目消息角色"
              value={entryForm.role ?? "system"}
              onChange={(e) =>
                setEntryForm({
                  ...entryForm,
                  role: e.target.value as LoreEntry["role"],
                })
              }
            >
              <option value="system">System</option>
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
            </select>
          </label>
          <p className="hint">
            OpenAI
            协议保留所选角色；若服务明确拒绝角色，最多重试一次并转为带标识的
            User 参考资料。Gemini 的历史内 System 会按原位置转为带标识的 User
            资料，并合并连续同角色；首尾 Assistant 必要时降级为 User 参考资料。
          </p>
          <label className="lore-check">
            <input
              aria-label="启用触发概率"
              type="checkbox"
              checked={entryForm.useProbability ?? false}
              onChange={(e) =>
                setEntryForm({
                  ...entryForm,
                  useProbability: e.target.checked,
                })
              }
            />
            启用 Probability / 触发概率
          </label>
          {entryForm.useProbability && (
            <label>
              触发概率 0–100
              <input
                aria-label="触发概率"
                type="number"
                min={0}
                max={100}
                step="any"
                value={entryForm.probability ?? 100}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    probability: e.target.valueAsNumber,
                  })
                }
              />
            </label>
          )}
          <details>
            <summary>高级设置</summary>
            <label>
              辅助关键词
              <textarea
                aria-label="辅助关键词"
                ref={secondaryInput}
                key={`secondary-${entryForm.id}`}
                defaultValue={keyText(entryForm.secondaryKeys)}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    secondaryKeys: keyLines(e.target.value, entryForm.regex),
                  })
                }
              />
            </label>
            <label className="lore-check">
              <input
                type="checkbox"
                checked={entryForm.selective}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    selective: e.target.checked,
                  })
                }
              />
              使用辅助条件
            </label>
            <label>
              辅助匹配逻辑
              <select
                aria-label="辅助匹配逻辑"
                value={entryForm.selectiveLogic}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    selectiveLogic: +e.target
                      .value as LoreEntry["selectiveLogic"],
                  })
                }
              >
                <option value={0}>任意辅助词命中</option>
                <option value={1}>辅助词并非全部命中</option>
                <option value={2}>所有辅助词均未命中</option>
                <option value={3}>所有辅助词均命中</option>
              </select>
            </label>
            <label className="lore-check">
              <input
                type="checkbox"
                checked={entryForm.caseSensitive}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    caseSensitive: e.target.checked,
                  })
                }
              />
              区分大小写
            </label>
            <label>
              关键词扫描深度（留空继承）
              <input
                aria-label="条目扫描深度"
                type="number"
                min={1}
                max={30}
                value={entryForm.scanDepth ?? ""}
                onChange={(e) =>
                  setEntryForm({
                    ...entryForm,
                    scanDepth:
                      e.target.value === "" ? null : e.target.valueAsNumber,
                  })
                }
              />
            </label>
          </details>
          {entryForm.compatibilityIssues.length > 0 && (
            <div className="card">
              <h3>兼容性暂停</h3>
              {entryForm.compatibilityIssues.slice(0, 20).map((m, i) => (
                <p key={i}>{m}</p>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      "确认仅使用当前编辑器显示的参数，放弃执行不支持的高级语义？原始元数据仍保留。",
                    )
                  )
                    setEntryForm({ ...entryForm, compatibilityIssues: [] });
                }}
              >
                确认转换为基础规则
              </button>
            </div>
          )}
          <div className="actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEntryForm(null)}
            >
              取消
            </button>
            <button className="primary" disabled={busy}>
              保存条目
            </button>
          </div>
        </form>
      )}
      <label className="lore-search">
        搜索条目
        <input
          aria-label="搜索世界书条目"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      {filtered.slice(page * 30, (page + 1) * 30).map((e) => (
        <section className="lore-entry-card" key={e.id} data-entry-id={e.id}>
          <FoldHeader
            name={e.title || "未命名条目"}
            description={e.primaryKeys.slice(0, 3).join("、") || "无关键词"}
            meta={`${e.enabled ? "已启用" : "已停用"} · ${e.constant ? "Constant / 常驻" : "关键词触发"}${e.compatibilityIssues.length ? " · 兼容性暂停" : ""}`}
            expanded={entryOpen.has(e.id)}
            id={`entry-${e.id}`}
            kind="条目"
            enabled={e.enabled}
            busy={busy}
            switchLabel={`条目「${e.title || "未命名条目"}」启用`}
            onSwitch={() => void switchEntry(e)}
            onToggle={() =>
              setEntryOpen((current) => {
                const next = new Set(current);
                if (next.has(e.id)) next.delete(e.id);
                else next.add(e.id);
                return next;
              })
            }
          />
          {entryOpen.has(e.id) && (
            <div className="lore-entry-body" id={`entry-${e.id}`}>
              <p className="preserve">{e.content}</p>
              <p className="hint">
                Regex：{e.regex ? "开" : "关"} · Role：{e.role ?? "system"} ·
                Position：{e.insertionPosition} · 注入深度：
                {e.insertionDepth ?? 0} · 关键词扫描深度：
                {e.scanDepth ?? "继承"} · 概率：
                {e.useProbability ? `${e.probability}%` : "关闭"} · Order：
                {e.priority}
              </p>
              <div className="api-actions">
                <button disabled={busy} onClick={() => setEntryForm({ ...e })}>
                  编辑条目
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await db.transaction(
                        "rw",
                        [db.lorebooks, db.loreEntries],
                        async () => {
                          const b = await db.lorebooks.get(e.lorebookId);
                          if (!b) throw Error("世界书已不存在。");
                          const copy = {
                            ...normalizeEntry(e),
                            id: crypto.randomUUID(),
                            title: `${e.title || "未命名条目"}（副本）`.slice(
                              0,
                              200,
                            ),
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                          };
                          const rows = await db.loreEntries
                            .where("lorebookId")
                            .equals(b.id)
                            .toArray();
                          validateLore(b, [...rows, copy]);
                          await db.loreEntries.add(copy);
                        },
                      );
                      await reload(selected.id);
                    })
                  }
                >
                  复制条目
                </button>

                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm("仅删除此条目？") &&
                      confirm("再次确认永久删除该条目？")
                    )
                      void action(async () => {
                        await db.loreEntries.delete(e.id);
                        if (entryForm?.id === e.id) setEntryForm(null);
                        await reload(selected.id);
                      });
                  }}
                >
                  删除条目
                </button>
              </div>
            </div>
          )}
        </section>
      ))}
      <div className="api-actions">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          上一页
        </button>
        <span>
          {page + 1} / {Math.max(1, Math.ceil(filtered.length / 30))}
        </span>
        <button
          disabled={(page + 1) * 30 >= filtered.length}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
      </div>
    </>
  ) : null;
  return (
    <div className="lore-app" ref={libraryRef}>
      <div className="page-title">
        <span className="eyebrow">LOREBOOK · 2.3.2</span>
        <h2>世界书 / Lorebook</h2>
        <p>
          只注入激活条目的内容，规则可增强遵循概率，但不能保证模型始终遵守。
        </p>
      </div>
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      <div className="lore-toolbar">
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setBookForm(newBook());
            setEntryForm(null);
          }}
        >
          <Plus size={15} />
          新建世界书
        </button>
        <div className="lore-import-control">
          <button
            type="button"
            className="primary lore-import-button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            从 JSON 导入世界书
          </button>
          <p className="hint">
            选择“文件”中的 .json，预览后确认导入，不会覆盖已有世界书。
          </p>
          <input
            ref={fileInput}
            className="lore-file-input"
            aria-label="导入世界书"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setPreview(null);
              void action(async () => {
                if (file.size > loreLimits.fileBytes)
                  throw Error("文件不能超过 5 MB。");
                const text = await file.text();
                setPreview(parseLorebook(text, file.name));
              });
            }}
          />
        </div>
      </div>
      <div className="lore-library-tools">
        <label className="lore-book-search">
          <Search size={16} />
          <input
            aria-label="搜索世界书"
            type="search"
            placeholder="搜索世界书"
            value={bookSearch}
            onChange={(e) => {
              setBookSearch(e.target.value);
              setBookPage(0);
            }}
          />
        </label>
        <div className="lore-filter" role="group" aria-label="筛选世界书">
          {(
            [
              ["all", "全部"],
              ["enabled", "已启用"],
              ["disabled", "未启用"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={bookFilter === value}
              onClick={() => {
                setBookFilter(value);
                setBookPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {preview && (
        <section className="card lore-preview">
          <h3>导入预览</h3>
          <p>格式：{preview.format}</p>
          <p>世界书：{preview.book.name}</p>
          <p>
            条目总数：{preview.total} · 可正常转换：{preview.valid} ·
            兼容性问题：
            {preview.issues}
          </p>
          {preview.issues > 0 && (
            <p>
              该世界书包含 Claudia Phone
              当前未完全支持的高级字段，基础内容仍可导入。有兼容性问题的条目在确认转换前不会注入
              Prompt。
            </p>
          )}
          {preview.warnings.slice(0, 30).map((w, i) => (
            <p key={i}>{w}</p>
          ))}
          <p className="hint">
            导入会创建独立新副本，不覆盖已有世界书。默认不绑定世界、不设为全局；导入后请选择作用范围。
          </p>
          <div className="api-actions">
            <button disabled={busy} onClick={() => setPreview(null)}>
              取消导入
            </button>
            <button
              className="primary"
              disabled={busy || (!preview.entries.length && preview.total > 0)}
              onClick={() =>
                void action(async () => {
                  const b = await importLorebook(preview);
                  setBookSearch("");
                  setBookFilter("all");
                  setBookPage(0);
                  setPreview(null);
                  setPage(0);
                  setQuery("");
                  await reload();
                })
              }
            >
              确认导入
            </button>
          </div>
        </section>
      )}
      {bookForm && (
        <form
          ref={bookEditorRef}
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const rows = await db.loreEntries
                .where("lorebookId")
                .equals(bookForm.id)
                .toArray();
              validateLore(bookForm, rows);
              await db.lorebooks.put({
                ...bookForm,
                name: bookForm.name.trim(),
                updatedAt: Date.now(),
              });
              if (!books.some((b) => b.id === bookForm.id)) {
                setBookSearch("");
                setBookFilter("all");
                setBookPage(0);
              }
              setBookForm(null);
              await reload(bookForm.id);
            });
          }}
        >
          <h3>编辑世界书</h3>
          <label>
            名称
            <input
              aria-label="世界书名称"
              required
              maxLength={120}
              value={bookForm.name}
              onChange={(e) =>
                setBookForm({ ...bookForm, name: e.target.value })
              }
            />
          </label>
          <label>
            描述
            <textarea
              aria-label="世界书描述"
              maxLength={10000}
              value={bookForm.description}
              onChange={(e) =>
                setBookForm({ ...bookForm, description: e.target.value })
              }
            />
          </label>
          <label className="lore-check">
            <input
              type="checkbox"
              checked={bookForm.enabled}
              onChange={(e) =>
                setBookForm({ ...bookForm, enabled: e.target.checked })
              }
            />
            启用世界书
          </label>
          <label className="lore-check">
            <input
              aria-label="全局世界书"
              type="checkbox"
              checked={bookForm.global}
              onChange={(e) =>
                setBookForm({ ...bookForm, global: e.target.checked })
              }
            />
            全局可用（包含日常和所有世界）
          </label>
          <fieldset>
            <legend>绑定用户世界（未设为全局时仅这些世界可用）</legend>
            {worlds.map((w) => (
              <label className="lore-check" key={w.id}>
                <input
                  aria-label={`绑定世界${w.name}`}
                  type="checkbox"
                  checked={bookForm.worldIds.includes(w.id)}
                  onChange={(e) =>
                    setBookForm({
                      ...bookForm,
                      worldIds: e.target.checked
                        ? [...bookForm.worldIds, w.id]
                        : bookForm.worldIds.filter((id) => id !== w.id),
                    })
                  }
                />
                {w.name}
              </label>
            ))}
            {!worlds.length && (
              <p className="hint">暂无世界；可保存为全局或暂不绑定。</p>
            )}
          </fieldset>
          <details>
            <summary>高级设置</summary>
            <label>
              默认关键词扫描深度
              <input
                aria-label="世界书扫描深度"
                type="number"
                min={1}
                max={30}
                value={bookForm.scanDepth}
                onChange={(e) =>
                  setBookForm({
                    ...bookForm,
                    scanDepth: e.target.valueAsNumber,
                  })
                }
              />
            </label>
            <label>
              字符预算
              <input
                aria-label="世界书字符预算"
                type="number"
                min={100}
                max={8000}
                value={bookForm.charBudget}
                onChange={(e) =>
                  setBookForm({
                    ...bookForm,
                    charBudget: e.target.valueAsNumber,
                  })
                }
              />
            </label>
          </details>
          <div className="actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setBookForm(null)}
            >
              取消
            </button>
            <button className="primary" disabled={busy}>
              保存世界书
            </button>
          </div>
        </form>
      )}
      <div className="lore-book-list">
        {visibleBooks.map((b) => (
          <section className="lore-book-card" data-book-id={b.id} key={b.id}>
            <FoldHeader
              name={b.name}
              description={b.description || "暂无简介"}
              meta={`${counts[b.id] ?? "…"} 条目`}
              expanded={selected?.id === b.id}
              onToggle={() => void toggleBook(b)}
              kind="世界书"
              id={`book-${b.id}`}
              enabled={b.enabled}
              busy={busy}
              switchLabel={`世界书「${b.name}」启用`}
              onSwitch={() => void switchBook(b)}
            />
            {selected?.id === b.id && (
              <div className="lore-book-body" id={`book-${b.id}`}>
                {expandedContent}
              </div>
            )}
          </section>
        ))}
      </div>
      {!matchingBooks.length && (
        <p className="empty">
          {books.length
            ? "没有匹配的世界书。"
            : "暂无世界书。新建或从文件导入。"}
        </p>
      )}
      {matchingBooks.length > 20 && (
        <div className="lore-book-pagination">
          <button
            disabled={bookPage === 0}
            onClick={() => setBookPage((p) => p - 1)}
          >
            上一组世界书
          </button>
          <span>
            {bookPage + 1} / {Math.ceil(matchingBooks.length / 20)}
          </span>
          <button
            disabled={(bookPage + 1) * 20 >= matchingBooks.length}
            onClick={() => setBookPage((p) => p + 1)}
          >
            下一组世界书
          </button>
        </div>
      )}
    </div>
  );
}

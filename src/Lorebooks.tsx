import { evaluateRegex, regexError } from "./loreRegex";
import { useEffect, useState, useRef } from "react";
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
export function Lorebooks() {
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLFormElement>(null);
  const primaryInput = useRef<HTMLTextAreaElement>(null);
  const secondaryInput = useRef<HTMLTextAreaElement>(null);
  const [regexSample, setRegexSample] = useState("");
  const [regexTest, setRegexTest] = useState("");
  const worlds = usePhone((s) => s.worlds);
  const [books, setBooks] = useState<Lorebook[]>([]);
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
    const rows = await db.lorebooks.toCollection().sortBy("updatedAt");
    setBooks(rows.reverse());
    if (id) {
      const b = await db.lorebooks.get(id);
      setSelected(b || null);
      setEntries(
        (await db.loreEntries.where("lorebookId").equals(id).toArray())
          .map(normalizeEntry)
          .sort(
            (a, b) =>
              b.priority - a.priority ||
              a.createdAt - b.createdAt ||
              a.id.localeCompare(b.id),
          ),
      );
    }
  };
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
  const filtered = entries.filter((e) =>
    `${e.title} ${e.primaryKeys.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="lore-app">
      <div className="page-title">
        <span className="eyebrow">LOREBOOK · 2.3.1</span>
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
      <div className="api-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setBookForm(newBook());
            setEntryForm(null);
          }}
        >
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
                  setPreview(null);
                  setPage(0);
                  setQuery("");
                  await reload(b.id);
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
      {!selected ? (
        <>
          {books.map((b) => (
            <div className="card" key={b.id}>
              <h3>{b.name}</h3>
              <p>
                {b.enabled ? "已启用" : "已停用"} ·{" "}
                {b.global ? "全局" : `绑定 ${b.worldIds.length} 个世界`}
              </p>
              <button
                className="primary"
                onClick={() =>
                  void action(async () => {
                    setPage(0);
                    setQuery("");
                    await reload(b.id);
                  })
                }
              >
                查看条目
              </button>
            </div>
          ))}
          {!books.length && (
            <p className="empty">暂无世界书。新建或从文件导入。</p>
          )}
        </>
      ) : (
        <>
          <div className="card">
            <h3>{selected.name}</h3>
            <p>{selected.description}</p>
            <p>
              {selected.global
                ? "全局可用"
                : `已绑定 ${selected.worldIds.length} 个世界；不进入日常聊天`}{" "}
              · {selected.enabled ? "已启用" : "已停用"} · {entries.length} 条
            </p>
            <div className="api-actions">
              <button
                onClick={() => {
                  setSelected(null);
                  setEntryForm(null);
                }}
              >
                全部世界书
              </button>
              <button
                disabled={busy}
                onClick={() => setBookForm({ ...selected })}
              >
                编辑世界书
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await db.lorebooks.update(selected.id, {
                      enabled: !selected.enabled,
                      updatedAt: Date.now(),
                    });
                    await reload(selected.id);
                  })
                }
              >
                {selected.enabled ? "停用世界书" : "启用世界书"}
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
                    )
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
                User 参考资料。Gemini 的历史内 System 会按原位置转为带标识的
                User 资料，并合并连续同角色；首尾 Assistant 必要时降级为 User
                参考资料。
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
                        secondaryKeys: keyLines(
                          e.target.value,
                          entryForm.regex,
                        ),
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
            <div className="card" key={e.id}>
              <details className="lore-entry-details">
                <summary>
                  <h3>{e.title || "未命名条目"}</h3>
                  <span>
                    {e.enabled ? "已启用" : "已停用"} ·{" "}
                    {e.constant ? "Constant / 常驻" : "关键词触发"} ·{" "}
                    {e.primaryKeys.slice(0, 3).join("、") || "无关键词"}
                  </span>
                </summary>
                <p className="preserve">{e.content}</p>
                <p>
                  Regex：{e.regex ? "开" : "关"} · Role：{e.role ?? "system"} ·
                  Position：{e.insertionPosition} · 注入深度：
                  {e.insertionDepth ?? 0} · 关键词扫描深度：
                  {e.scanDepth ?? "继承"} · 概率：
                  {e.useProbability ? `${e.probability}%` : "关闭"} · Order：
                  {e.priority}
                </p>
              </details>
              <p>
                {e.content.slice(0, 180)}
                {e.content.length > 180 ? "…" : ""}
              </p>
              <p>
                {e.constant ? "常驻" : "关键词触发"} ·{" "}
                {e.enabled ? "已启用" : "已停用"} · 优先级 {e.priority}
                {e.compatibilityIssues.length ? " · 兼容性暂停" : ""}
              </p>
              <div className="api-actions">
                <button disabled={busy} onClick={() => setEntryForm({ ...e })}>
                  编辑条目
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await db.loreEntries.update(e.id, {
                        enabled: !e.enabled,
                        updatedAt: Date.now(),
                      });
                      await reload(selected.id);
                    })
                  }
                >
                  {e.enabled ? "停用条目" : "启用条目"}
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
                    if (confirm("仅删除此条目？"))
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
      )}
    </div>
  );
}

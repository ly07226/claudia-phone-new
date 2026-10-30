import { ApiSettings } from "./ApiSettings";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MessageCircle,
  NotebookPen,
  Music2,
  CalendarDays,
  ScanFace,
  ShoppingBag,
  BookOpen,
  Flower2,
  Settings,
  Palette,
  Globe2,
  Users,
  ChevronLeft,
  Plus,
  X,
  Check,
  Wifi,
  BatteryFull,
  Signal,
  ArrowRight,
  ImagePlus,
  Grip,
  Trash2,
} from "lucide-react";
import {
  usePhone,
  apps,
  db,
  safeWrite,
  upload,
  defaultItems,
  defaultTheme,
  moveItem,
  type DesktopItem,
  type World,
  type Character,
} from "./store";
import "./style.css";
const icons = [
  MessageCircle,
  NotebookPen,
  Music2,
  CalendarDays,
  ScanFace,
  ShoppingBag,
  BookOpen,
  Flower2,
  Settings,
  Palette,
  Globe2,
  Users,
];
function App() {
  const s = usePhone();
  const [now, setNow] = useState(new Date());
  const [drag, setDrag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gesture = useRef<
    | {
        x: number;
        y: number;
        timer?: ReturnType<typeof setTimeout>;
        id: string;
        drag: boolean;
        cancelled: boolean;
      }
    | undefined
  >(undefined);
  const suppress = useRef(false);
  const swipe = useRef<number | null>(null);
  useEffect(() => {
    void s.init();
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const asset = (id?: string) => s.assets.find((a) => a.id === id)?.data;
  async function fileChange(
    file: File | undefined,
    type: "wallpaper" | "icon" | "avatar",
    done: (id: string) => Promise<unknown>,
  ) {
    if (!file) return;
    setBusy(true);
    try {
      await done(await upload(file, type));
    } catch (e) {
      s.set({ error: e instanceof Error ? e.message : "图片处理失败" });
    } finally {
      setBusy(false);
    }
  }
  function start(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    suppress.current = false;
    const g = {
      x: e.clientX,
      y: e.clientY,
      id,
      drag: s.editing,
      cancelled: false,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    gesture.current = g;
    if (s.editing) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag(id);
    } else
      g.timer = setTimeout(() => {
        g.drag = true;
        suppress.current = true;
        s.set({ editing: true });
        setDrag(id);
        navigator.vibrate?.(20);
      }, 550);
  }
  function motion(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (!g.drag && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) {
      clearTimeout(g.timer);
      g.cancelled = true;
      suppress.current = true;
    }
    if (g.drag) {
      e.preventDefault();
      setDrag(g.id);
    }
  }
  function end(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.drag) {
      suppress.current = true;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const page = el?.closest<HTMLElement>("[data-page]")?.dataset.page;
      const target = el?.closest<HTMLElement>("[data-item]")?.dataset.item;
      if (page) {
        void s.saveDesktop(moveItem(s.items, g.id, page));
        s.set({ pageId: page });
      } else if (target && target !== g.id)
        void s.saveDesktop(moveItem(s.items, g.id, s.pageId, target));
    }
    setDrag(null);
    gesture.current = undefined;
  }
  const pageIndex = s.pages.findIndex((p) => p.id === s.pageId);
  const pageItems = s.items
    .filter((i) => i.pageId === s.pageId)
    .sort((a, b) => a.position - b.position);
  function widget(item: DesktopItem) {
    return (
      <div className="widget-content">
        {item.widget === "quote" ? (
          <>
            <span className="eyebrow">A LITTLE MOMENT</span>
            <p>
              把日子过成
              <br />
              <em>自己喜欢的模样。</em>
            </p>
            <span className="widget-foot">
              <span>慢慢来，也很好</span>
              <Flower2 size={27} />
            </span>
          </>
        ) : item.widget === "calendar" ? (
          <>
            <span className="eyebrow">TODAY / 今日</span>
            <p>
              {now.getDate()}{" "}
              <small>
                {now.toLocaleDateString("zh-CN", { weekday: "long" })}
              </small>
            </p>
            <span>留一点时间给自己。</span>
          </>
        ) : (
          <>
            <span className="eyebrow">NOTE TO SELF</span>
            <p>
              记得呼吸，
              <br />
              记得感受当下。
            </p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="stage">
      <aside className="brand">
        <span className="brand-mark">c.</span>
        <h1>
          Claudia
          <br />
          Phone<span>你的世界，随身携带。</span>
        </h1>
        <p>A quiet place for your stories.</p>
        <div className="brand-line" />
        <span className="eyebrow">PERSONAL SPACE · PHASE 01</span>
      </aside>
      <main
        className={`phone ${s.editing ? "editing" : ""}`}
        style={
          {
            "--accent": s.theme.color,
            "--glass": s.theme.opacity,
            "--blur": `${s.theme.blur}px`,
            fontFamily:
              s.theme.font === "serif"
                ? 'Georgia, "Songti SC", serif'
                : undefined,
            backgroundColor: s.theme.color,
            backgroundImage: asset(s.theme.wallpaper)
              ? `url(${asset(s.theme.wallpaper)})`
              : undefined,
          } as React.CSSProperties
        }
      >
        <div
          className="wallpaper-art"
          style={{ display: s.theme.wallpaper ? "none" : undefined }}
        />
        <div className="status">
          <span>
            {now.toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <div className="island" />
          <span className="status-icons">
            <Signal size={14} />
            <Wifi size={15} />
            <BatteryFull size={20} />
          </span>
        </div>
        {!s.ready ? (
          <div className="loading">正在整理你的小小世界…</div>
        ) : s.activeApp ? (
          <section className="app-panel" key={s.activeApp}>
            <header>
              <button
                aria-label="返回桌面"
                onClick={() => s.set({ activeApp: null })}
              >
                <ChevronLeft />
                桌面
              </button>
              <span>{s.activeApp}</span>
              <Flower2 size={20} />
            </header>
            <div className="app-scroll">
              {s.activeApp === "设置" ? (
                <>
                  <div className="page-title">
                    <span className="eyebrow">MAKE IT YOURS</span>
                    <h2>设置</h2>
                    <p>让这里，成为你的舒适区。</p>
                  </div>
                  <div className="card">
                    <h3>
                      Claudia Phone <small>第二阶段 · 2.1</small>
                    </h3>
                    <p>
                      所有数据仅保存在当前浏览器。可配置和测试 AI
                      API，正式聊天尚未实现。
                    </p>
                  </div>
                  <button
                    className="list-row"
                    onClick={() => s.set({ activeApp: "AI / API 设置" })}
                  >
                    <Settings />
                    AI / API 设置
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="list-row"
                    onClick={() => s.set({ activeApp: "主题编辑器" })}
                  >
                    <Palette />
                    主题与桌面
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="list-row"
                    onClick={() => s.set({ activeApp: null, editing: true })}
                  >
                    <Grip />
                    编辑桌面
                    <ArrowRight size={17} />
                  </button>
                  <div className="card">
                    <h3>本地存储</h3>
                    <p>
                      {s.worlds.length} 个世界 · {s.characters.length} 位角色 ·{" "}
                      {s.assets.length} 张图片
                    </p>
                    <p>
                      清除网站数据会删除本地内容，请保留重要人设备份。iPhone
                      请通过 HTTPS 网站或「添加到主屏幕」运行。
                    </p>
                  </div>
                  <button
                    className="danger list-row"
                    onClick={() => {
                      if (confirm("恢复默认桌面和主题？世界和角色会保留。"))
                        void s
                          .saveDesktop(defaultItems(), [
                            { id: "page-1", order: 0 },
                          ])
                          .then(() => {
                            s.set({ pageId: "page-1" });
                            return s.saveTheme(defaultTheme);
                          });
                    }}
                  >
                    恢复默认桌面布局与主题
                  </button>
                </>
              ) : s.activeApp === "AI / API 设置" ? (
                <ApiSettings />
              ) : s.activeApp === "主题编辑器" ? (
                <>
                  <div className="page-title">
                    <span className="eyebrow">A SOFTER EVERYDAY</span>
                    <h2>主题编辑器</h2>
                    <p>微调一点点，就很不一样。</p>
                  </div>
                  <div className="theme-preview">
                    <Flower2 size={32} />
                    <span>属于你的 Claudia</span>
                    <small>全局主题 · 实时保存</small>
                  </div>
                  <div className="card form">
                    <label>
                      主题色{" "}
                      <input
                        aria-label="主题色"
                        type="color"
                        value={s.theme.color}
                        onChange={(e) =>
                          void s.saveTheme({
                            ...s.theme,
                            color: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      玻璃透明度{" "}
                      <output>{Math.round(s.theme.opacity * 100)}%</output>
                      <input
                        aria-label="玻璃透明度"
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.01"
                        value={s.theme.opacity}
                        onChange={(e) =>
                          void s.saveTheme({
                            ...s.theme,
                            opacity: +e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      背景模糊 <output>{s.theme.blur}px</output>
                      <input
                        aria-label="背景模糊"
                        type="range"
                        min="0"
                        max="40"
                        value={s.theme.blur}
                        onChange={(e) =>
                          void s.saveTheme({
                            ...s.theme,
                            blur: +e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      字体
                      <select
                        value={s.theme.font}
                        onChange={(e) =>
                          void s.saveTheme({ ...s.theme, font: e.target.value })
                        }
                      >
                        <option value="sans">清晰无衬线</option>
                        <option value="serif">文艺衬线</option>
                      </select>
                    </label>
                    <label>
                      图标形状
                      <select
                        value={s.theme.iconStyle}
                        onChange={(e) =>
                          void s.saveTheme({
                            ...s.theme,
                            iconStyle: e.target.value as "rounded" | "squircle",
                          })
                        }
                      >
                        <option value="rounded">柔和圆角</option>
                        <option value="squircle">圆形</option>
                      </select>
                    </label>
                  </div>
                  <label className="list-row upload">
                    <ImagePlus />
                    上传桌面壁纸
                    <input
                      aria-label="上传桌面壁纸"
                      type="file"
                      accept="image/*"
                      disabled={busy}
                      onChange={(e) =>
                        void fileChange(
                          e.target.files?.[0],
                          "wallpaper",
                          (id) => s.saveTheme({ ...s.theme, wallpaper: id }),
                        )
                      }
                    />
                  </label>
                  {s.theme.wallpaper && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void s.saveTheme({ ...s.theme, wallpaper: undefined })
                      }
                    >
                      使用默认壁纸
                    </button>
                  )}
                  <div className="card">
                    <h3>自定义应用图标</h3>
                    {apps.map((app) => (
                      <label className="icon-upload" key={app}>
                        {app}
                        <span>更换图片 +</span>
                        <input
                          aria-label={`上传${app}图标`}
                          type="file"
                          accept="image/*"
                          disabled={busy}
                          onChange={(e) =>
                            void fileChange(e.target.files?.[0], "icon", (id) =>
                              s.saveDesktop(
                                s.items.map((i) =>
                                  i.app === app ? { ...i, icon: id } : i,
                                ),
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p className="hint">
                    图片上限 20
                    MB，上传后自动压缩。世界独立主题接口已预留，当前使用全局主题。
                  </p>
                </>
              ) : s.activeApp === "世界管理" ? (
                <Worlds />
              ) : s.activeApp === "角色管理" ? (
                <Characters fileChange={fileChange} />
              ) : (
                <div className="placeholder">
                  <div className="placeholder-icon">
                    {React.createElement(
                      icons[apps.indexOf(s.activeApp)] || Flower2,
                      { size: 40 },
                    )}
                  </div>
                  <span className="eyebrow">COMING IN A LATER CHAPTER</span>
                  <h2>{s.activeApp}</h2>
                  <p>这个小世界，还在慢慢生长。</p>
                  <div className="card">
                    第一阶段占位页面
                    <br />
                    尚未实现该应用，也未连接 AI 服务。
                  </div>
                  <button
                    className="primary"
                    onClick={() => s.set({ activeApp: "角色管理" })}
                  >
                    先认识你的角色 <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section
            className="desktop"
            onTouchStart={(e) => {
              if (!s.editing) swipe.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (swipe.current !== null && !s.editing) {
                const dx = e.changedTouches[0].clientX - swipe.current;
                if (Math.abs(dx) > 65) {
                  const p = s.pages[pageIndex + (dx < 0 ? 1 : -1)];
                  if (p) s.set({ pageId: p.id });
                }
              }
              swipe.current = null;
            }}
          >
            <div className="clock">
              <span className="eyebrow">
                {now
                  .toLocaleDateString("en-US", { weekday: "long" })
                  .toUpperCase()}
              </span>
              <h2>
                {now.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </h2>
              <p>
                {now.toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}{" "}
                <span>· 好好生活</span>
              </p>
            </div>
            {s.editing && (
              <div className="edit-tools">
                <button
                  onClick={() => {
                    const id = crypto.randomUUID();
                    void s.saveDesktop(s.items, [
                      ...s.pages,
                      { id, order: s.pages.length },
                    ]);
                    s.set({ pageId: id });
                  }}
                >
                  <Plus size={14} />
                  页面
                </button>
                <button
                  onClick={() =>
                    void s.saveDesktop([
                      ...s.items,
                      {
                        id: crypto.randomUUID(),
                        kind: "widget",
                        widget: "calendar",
                        pageId: s.pageId,
                        position: Date.now(),
                        size: 2,
                      },
                    ])
                  }
                >
                  <Plus size={14} />
                  小组件
                </button>
                <button onClick={() => s.set({ editing: false })}>
                  <Check size={14} />
                  完成
                </button>
              </div>
            )}
            <div className="grid" key={s.pageId}>
              {pageItems.map((item) => {
                const Icon = icons[apps.indexOf(item.app || "")] || Flower2;
                return (
                  <div
                    key={item.id}
                    data-item={item.id}
                    className={`desktop-item ${item.kind === "widget" ? "widget glass" : ""} ${drag === item.id ? "dragging" : ""}`}
                    style={{
                      gridColumn: `span ${item.kind === "widget" ? item.size : 1}`,
                    }}
                    onPointerDown={(e) => start(e, item.id)}
                    onPointerMove={motion}
                    onPointerUp={end}
                    onPointerCancel={() => {
                      clearTimeout(gesture.current?.timer);
                      gesture.current = undefined;
                      setDrag(null);
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <button
                      className="item-button"
                      aria-label={item.app || "小组件"}
                      onClick={() => {
                        if (suppress.current) {
                          suppress.current = false;
                          return;
                        }
                        if (!s.editing && item.app)
                          s.set({ activeApp: item.app });
                      }}
                    >
                      {item.kind === "widget" ? (
                        widget(item)
                      ) : (
                        <>
                          <span
                            className="app-icon glass"
                            style={{
                              borderRadius:
                                s.theme.iconStyle === "squircle"
                                  ? "50%"
                                  : undefined,
                            }}
                          >
                            {asset(item.icon) ? (
                              <img
                                draggable={false}
                                src={asset(item.icon)}
                                alt=""
                              />
                            ) : (
                              <Icon size={29} strokeWidth={1.45} />
                            )}
                          </span>
                          <span className="app-label">{item.app}</span>
                        </>
                      )}
                    </button>
                    {s.editing && (
                      <div
                        className="item-edit"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {item.kind === "widget" ? (
                          <>
                            <button
                              aria-label="删除小组件"
                              onClick={() =>
                                void s.saveDesktop(
                                  s.items.filter((i) => i.id !== item.id),
                                )
                              }
                            >
                              <X size={13} />
                            </button>
                            <button
                              aria-label="调整小组件尺寸"
                              onClick={() =>
                                void s.saveDesktop(
                                  s.items.map((i) =>
                                    i.id === item.id
                                      ? {
                                          ...i,
                                          size:
                                            i.size === 4
                                              ? 2
                                              : i.size === 2
                                                ? 1
                                                : 4,
                                        }
                                      : i,
                                  ),
                                )
                              }
                            >
                              ↔
                            </button>
                            <select
                              aria-label="小组件类型"
                              value={item.widget}
                              onChange={(e) =>
                                void s.saveDesktop(
                                  s.items.map((i) =>
                                    i.id === item.id
                                      ? {
                                          ...i,
                                          widget: e.target.value as "quote",
                                        }
                                      : i,
                                  ),
                                )
                              }
                            >
                              <option value="quote">语录</option>
                              <option value="calendar">日历</option>
                              <option value="note">便签</option>
                            </select>
                          </>
                        ) : (
                          <span>
                            <Grip size={12} />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {pageItems.length === 0 && (
              <p className="empty-page">
                一张留白，等待你的故事。
                <br />
                编辑模式下将图标拖到下方圆点即可移入此页。
              </p>
            )}
            <div className="page-dots">
              {s.pages.map((p, i) => (
                <button
                  data-page={p.id}
                  aria-label={`桌面第${i + 1}页`}
                  className={s.pageId === p.id ? "active" : ""}
                  key={p.id}
                  onClick={() => s.set({ pageId: p.id })}
                />
              ))}
              {s.editing && <span>拖到圆点以跨页移动</span>}
            </div>
            <div className="dock glass">
              {[0, 2, 10, 8].map((index) => {
                const Icon = icons[index];
                return (
                  <button
                    key={index}
                    aria-label={`Dock ${apps[index]}`}
                    onClick={() => {
                      if (!s.editing) s.set({ activeApp: apps[index] });
                    }}
                  >
                    <Icon size={27} strokeWidth={1.4} />
                  </button>
                );
              })}
            </div>
            <div className="home-indicator" />
          </section>
        )}
        {s.error && (
          <div className="toast" role="alert">
            {s.error}
            <button aria-label="关闭提示" onClick={() => s.set({ error: "" })}>
              <X size={18} />
            </button>
          </div>
        )}
        {busy && (
          <div className="toast" role="status">
            正在处理并保存图片…
          </div>
        )}
      </main>
      <aside className="side-note">
        <span>01 / YOUR EVERYDAY ESCAPE</span>
        <p>
          留一点空白，
          <br />
          装下无限可能。
        </p>
        <small>长按图标，开始定制你的桌面。</small>
      </aside>
    </div>
  );
}
function Worlds() {
  const s = usePhone();
  const [form, setForm] = useState<Partial<World> | null>(null);
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">WHERE STORIES BEGIN</span>
        <h2>世界管理</h2>
        <p>每个世界，都有自己的故事。</p>
      </div>
      <button
        className="primary"
        onClick={() => setForm({ name: "", description: "" })}
      >
        <Plus size={17} />
        创建世界
      </button>
      {form && (
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void safeWrite(() =>
              db.worlds.put({
                id: form.id || crypto.randomUUID(),
                name: form.name!.trim(),
                description: form.description || "",
                createdAt: form.createdAt || Date.now(),
              }),
            ).then((ok) => {
              if (ok) setForm(null);
            });
          }}
        >
          <h3>{form.id ? "编辑世界" : "新世界"}</h3>
          <label>
            世界名称
            <input
              aria-label="世界名称"
              required
              maxLength={80}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              pattern=".*\S.*"
            />
          </label>
          <label>
            世界描述
            <textarea
              aria-label="世界描述"
              maxLength={10000}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => setForm(null)}>
              取消
            </button>
            <button className="primary" type="submit">
              保存世界
            </button>
          </div>
        </form>
      )}
      {!s.worlds.length && !form && (
        <div className="empty">
          <Globe2 size={42} />
          <h3>从一个世界开始</h3>
          <p>创建世界后，即可在其中添加专属角色。</p>
        </div>
      )}
      {s.worlds.map((w) => (
        <div className="card" key={w.id}>
          <div className="card-heading">
            <Globe2 size={22} />
            <h3>{w.name}</h3>
          </div>
          <p className="preserve">
            {w.description || "这里的故事，等你来写。"}
          </p>
          <small>
            {new Date(w.createdAt).toLocaleDateString("zh-CN")} ·{" "}
            {s.characters.filter((c) => c.worldId === w.id).length} 位角色
          </small>
          <div className="actions">
            <button
              onClick={() => {
                s.set({ worldId: w.id, activeApp: "角色管理" });
              }}
            >
              查看角色
            </button>
            <button onClick={() => setForm(w)}>编辑</button>
            <button
              className="danger"
              aria-label={`删除世界${w.name}`}
              onClick={() => {
                if (confirm(`删除「${w.name}」及其中全部角色？`))
                  void safeWrite(() =>
                    db.transaction(
                      "rw",
                      [db.worlds, db.characters],
                      async () => {
                        await db.characters
                          .where("worldId")
                          .equals(w.id)
                          .delete();
                        await db.worlds.delete(w.id);
                      },
                    ),
                  );
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
function Characters({
  fileChange,
}: {
  fileChange: (
    file: File | undefined,
    type: "avatar",
    done: (id: string) => Promise<unknown>,
  ) => Promise<void>;
}) {
  const s = usePhone();
  const selected = s.worlds.some((w) => w.id === s.worldId)
    ? s.worldId
    : s.worlds[0]?.id || "";
  const [form, setForm] = useState<Partial<Character> | null>(null);
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">PEOPLE IN YOUR UNIVERSE</span>
        <h2>角色管理</h2>
        <p>相遇，从一段人设开始。</p>
      </div>
      {!selected ? (
        <div className="empty">
          <Users size={42} />
          <h3>先为角色创建一个世界</h3>
          <p>角色始终属于一个世界，彼此的数据独立。</p>
          <button
            className="primary"
            onClick={() => s.set({ activeApp: "世界管理" })}
          >
            去创建世界
          </button>
        </div>
      ) : (
        <>
          <label className="world-select">
            当前世界
            <select
              aria-label="当前世界"
              value={selected}
              onChange={(e) => {
                s.set({ worldId: e.target.value });
                setForm(null);
              }}
            >
              {s.worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            onClick={() =>
              setForm({ worldId: selected, name: "", persona: "" })
            }
          >
            <Plus size={17} />
            创建角色
          </button>
          {form && (
            <form
              className="card form"
              onSubmit={(e) => {
                e.preventDefault();
                if (form.worldId !== selected) return;
                void safeWrite(async () => {
                  if (!(await db.worlds.get(selected)))
                    throw Error("世界不存在");
                  await db.characters.put({
                    id: form.id || crypto.randomUUID(),
                    worldId: selected,
                    name: form.name!.trim(),
                    persona: form.persona || "",
                    avatar: form.avatar,
                    apiConfigId: form.apiConfigId,
                  });
                }).then((ok) => {
                  if (ok) setForm(null);
                });
              }}
            >
              <h3>{form.id ? "编辑角色" : "新角色"}</h3>
              <label>
                姓名
                <input
                  aria-label="角色姓名"
                  required
                  pattern=".*\S.*"
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                人设
                <textarea
                  aria-label="角色人设"
                  maxLength={20000}
                  value={form.persona}
                  onChange={(e) =>
                    setForm({ ...form, persona: e.target.value })
                  }
                />
              </label>
              <label className="upload avatar-upload">
                {form.avatar ? (
                  <img
                    src={s.assets.find((a) => a.id === form.avatar)?.data}
                    alt="角色头像预览"
                  />
                ) : (
                  <Users />
                )}{" "}
                上传头像
                <input
                  aria-label="上传头像"
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    void fileChange(e.target.files?.[0], "avatar", async (id) =>
                      setForm({ ...form, avatar: id }),
                    )
                  }
                />
              </label>
              <div className="actions">
                <button type="button" onClick={() => setForm(null)}>
                  取消
                </button>
                <button type="submit" className="primary">
                  保存角色
                </button>
              </div>
            </form>
          )}
          {s.characters
            .filter((c) => c.worldId === selected)
            .map((c) => (
              <div className="card" key={c.id}>
                <div className="card-heading">
                  {c.avatar ? (
                    <img
                      className="avatar"
                      alt={`${c.name}头像`}
                      src={s.assets.find((a) => a.id === c.avatar)?.data}
                    />
                  ) : (
                    <Users size={27} />
                  )}
                  <h3>{c.name}</h3>
                </div>
                <p className="preserve">{c.persona || "尚未填写人设"}</p>
                <div className="actions">
                  <button onClick={() => setForm(c)}>编辑角色</button>
                  <button
                    className="danger"
                    onClick={() => {
                      if (confirm(`删除角色「${c.name}」？`))
                        void safeWrite(() => db.characters.delete(c.id));
                    }}
                  >
                    删除角色
                  </button>
                </div>
              </div>
            ))}
          {!form && !s.characters.some((c) => c.worldId === selected) && (
            <p className="empty">这个世界还没有角色，创建第一位吧。</p>
          )}
        </>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() =>
        usePhone
          .getState()
          .set({ error: "离线缓存不可用，在线功能仍可使用。" }),
      );
  });

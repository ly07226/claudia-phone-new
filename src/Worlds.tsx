import { useState, type ReactNode } from "react";
import { Plus, Globe2 } from "lucide-react";
import { db, safeWrite, usePhone, type World } from "./store";
import { deleteWorld } from "./chatService";
export function Worlds({
  onCharacters, spaceList = false, renderSpaceActions, onEnterWorld,
}: { onCharacters?: (id: string) => void; spaceList?: boolean; renderSpaceActions?: (world: World) => ReactNode; onEnterWorld?: (id: string) => void } = {}) {
  const s = usePhone();
  const [creationOpen, setCreationOpen] = useState(false);
  const [creationNotice, setCreationNotice] = useState("");
  const [form, setForm] = useState<Partial<World> | null>(null);
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">WHERE STORIES BEGIN</span>
        {spaceList ? <h1>剧本世界</h1> : <h2>世界管理</h2>}
        <p>每个世界，都有自己的故事。</p>
      </div>
      <button
        className="primary"
        aria-expanded={spaceList ? creationOpen : undefined}
        aria-controls={spaceList ? "script-creation-methods" : undefined}
        onClick={() => {
          if (spaceList) {setCreationOpen(!creationOpen); setCreationNotice("");}
          else setForm({ name: "", description: "" });
        }}
      >
        <Plus size={17} />
        {spaceList ? "新建剧本" : "创建世界"}
      </button>
      {spaceList && creationOpen && <div className="script-creation-methods" id="script-creation-methods">
        <button onClick={() => {setForm({name:"", description:""}); setCreationNotice("");}}>手动粘贴</button>
        <button onClick={() => setCreationNotice("AI 剧本生成器即将开放")}>AI 生成</button>
      </div>}
      {spaceList && creationNotice && <p role="status" className="space-notice">{creationNotice}</p>}
      {form && (
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void safeWrite(() =>
              db.worlds.put({
                ...form,
                id: form.id || crypto.randomUUID(),
                name: form.name!.trim(),
                description: form.description || "",
                rules: form.rules || "",
                background: form.background || "",
                createdAt: form.createdAt || Date.now(),
              }),
            ).then((ok) => {
              if (ok) setForm(null);
            });
          }}
        >
          <h3>{form.id ? "编辑世界" : "新世界"}</h3>
          {spaceList && !form.id && <p className="hint">可直接粘贴到下方文本框。本版本沿用手动表单，暂不提供结构化剧本文件解析；点击保存才会创建剧本。</p>}
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
          <label>
            世界规则
            <textarea
              aria-label="世界规则"
              maxLength={4000}
              value={form.rules || ""}
              onChange={(e) => setForm({ ...form, rules: e.target.value })}
            />
          </label>
          <label>
            {spaceList && !form.id ? "剧本文本（手动粘贴）" : "世界背景与补充"}
            <textarea
              aria-label="世界背景"
              maxLength={6000}
              value={form.background || ""}
              onChange={(e) => setForm({ ...form, background: e.target.value })}
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
          <h3>{spaceList ? "暂无剧本" : "从一个世界开始"}</h3>
          <p>{spaceList ? "创建剧本后可关联现有角色，进入该世界手机。" : "创建世界后可关联基础角色；没有世界也可以日常聊天。"}</p>
        </div>
      )}
      {s.worlds.map((w) => (
        <div className={spaceList ? "card space-card" : "card"} key={w.id} data-testid={spaceList ? `world-space-${w.id}` : undefined}
          onClick={spaceList && onEnterWorld ? (event) => {
            if ((event.target as Element).closest("button, a, input, textarea, select, .script-archives")) return;
            onEnterWorld(w.id);
          } : undefined}>
          <div className="card-heading">
            <Globe2 size={22} />
            <h3 aria-label={spaceList ? w.name : undefined}>{spaceList && onEnterWorld ? <button className="script-card-title" aria-label={`进入剧本 · ${w.name}`} onClick={() => onEnterWorld(w.id)}>{w.name}</button> : w.name}</h3>
          </div>
          <p className={spaceList ? "space-description" : "preserve"}>
            {w.description || "这里的故事，等你来写。"}
          </p>
          <small>
            {new Date(w.createdAt).toLocaleDateString("zh-CN")} ·{" "}
            {s.worldProfiles.filter((p) => p.worldId === w.id).length} 位角色
          </small>
          {renderSpaceActions?.(w)}
          <div className="actions">
            <button
              onClick={() => {
                if (onCharacters) onCharacters(w.id);
                else s.set({ worldId: w.id, activeApp: "角色管理" });
              }}
            >
              查看角色
            </button>
            <button onClick={() => setForm(w)}>编辑</button>
            <button
              className="danger"
              aria-label={`删除世界${w.name}`}
              onClick={() => {
                if (
                  confirm(
                    `删除世界「${w.name}」及其世界聊天记录和关联？基础角色与日常聊天将保留。`,
                  ) &&
                  confirm(
                    "再次确认删除该世界及其全部世界会话？此操作不可撤销。",
                  )
                )
                  void safeWrite(() => deleteWorld(w.id));
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

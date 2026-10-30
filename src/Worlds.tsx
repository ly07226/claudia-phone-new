import { useState } from "react";
import { Plus, Globe2 } from "lucide-react";
import { db, safeWrite, usePhone, type World } from "./store";
import { deleteWorld } from "./chatService";
export function Worlds({
  onCharacters,
}: { onCharacters?: (id: string) => void } = {}) {
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
            世界背景与补充
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
          <h3>从一个世界开始</h3>
          <p>创建世界后可关联基础角色；没有世界也可以日常聊天。</p>
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
            {s.worldProfiles.filter((p) => p.worldId === w.id).length} 位角色
          </small>
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

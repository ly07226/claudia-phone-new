import { useEffect, useState } from "react";
import { db, safeWrite, usePhone, type Character } from "./store";
import { deleteCharacter } from "./chatService";
import type { ApiConfig } from "./api";
import type { WorldCharacterProfile } from "./chatTypes";
export function CharacterManager({
  fileChange,
}: {
  fileChange: (
    file: File | undefined,
    type: "avatar",
    done: (id: string) => Promise<unknown>,
  ) => Promise<void>;
}) {
  const s = usePhone();
  const [selected, setSelected] = useState(
    s.worlds.some((w) => w.id === s.worldId)
      ? s.worldId
      : s.worlds[0]?.id || "",
  );
  const [form, setForm] = useState<Partial<Character> | null>(null);
  const [profile, setProfile] = useState<WorldCharacterProfile | null>(null);
  const [link, setLink] = useState("");
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  useEffect(() => {
    void db.apiConfigs
      .toArray()
      .then(setConfigs)
      .catch(() => s.set({ error: "无法读取 API 配置。" }));
  }, []);
  const characters = selected
    ? s.characters.filter((c) =>
        s.worldProfiles.some(
          (p) => p.worldId === selected && p.characterId === c.id,
        ),
      )
    : s.characters;
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">PEOPLE IN YOUR UNIVERSE</span>
        <h2>角色管理</h2>
        <p>基础角色可用于日常聊天，也可关联多个世界。</p>
      </div>
      <label className="world-select">
        当前世界
        <select
          aria-label="当前世界"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            s.set({ worldId: e.target.value });
            setForm(null);
            setProfile(null);
          }}
        >
          <option value="">全部基础角色 / 无世界</option>
          {s.worlds.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="primary"
        onClick={() => setForm({ name: "", persona: "", speakingStyle: "" })}
      >
        创建角色
      </button>
      {selected && (
        <div className="card">
          <h3>关联已有基础角色</h3>
          <label className="world-select">
            选择角色
            <select
              aria-label="关联已有角色"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            >
              <option value="">请选择</option>
              {s.characters
                .filter((c) => !characters.some((x) => x.id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={!link}
            onClick={() =>
              void safeWrite(async () => {
                if (
                  !(await db.characters.get(link)) ||
                  !(await db.worlds.get(selected))
                )
                  throw Error("关联已失效");
                await db.worldProfiles.add({
                  id: crypto.randomUUID(),
                  worldId: selected,
                  characterId: link,
                  setting: "",
                });
              }).then((ok) => {
                if (ok) setLink("");
              })
            }
          >
            关联角色
          </button>
          <button
            className="primary"
            onClick={() => s.set({ worldId: selected, activeApp: "世界聊天" })}
          >
            进入世界聊天
          </button>
        </div>
      )}
      {form && (
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void safeWrite(() =>
              db.transaction(
                "rw",
                [db.characters, db.worlds, db.worldProfiles],
                async () => {
                  const id = form.id || crypto.randomUUID();
                  if (selected && !(await db.worlds.get(selected)))
                    throw Error("世界不存在");
                  await db.characters.put({
                    ...form,
                    id,
                    name: form.name!.trim(),
                    persona: form.persona || "",
                    speakingStyle: form.speakingStyle || "",
                  });
                  if (!form.id && selected)
                    await db.worldProfiles.add({
                      id: crypto.randomUUID(),
                      worldId: selected,
                      characterId: id,
                      setting: "",
                    });
                },
              ),
            ).then((ok) => {
              if (ok) setForm(null);
            });
          }}
        >
          <h3>{form.id ? "编辑角色" : "新角色"}</h3>
          <p className="hint">这里修改的是共用基础资料，不是世界专属身份。</p>
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
            基础人设
            <textarea
              aria-label="角色人设"
              maxLength={16000}
              value={form.persona}
              onChange={(e) => setForm({ ...form, persona: e.target.value })}
            />
          </label>
          <label>
            基础说话方式
            <textarea
              aria-label="说话方式"
              maxLength={2000}
              value={form.speakingStyle || ""}
              onChange={(e) =>
                setForm({ ...form, speakingStyle: e.target.value })
              }
            />
          </label>
          <label>
            默认 API
            <select
              aria-label="角色 API"
              value={form.apiConfigId || ""}
              onChange={(e) =>
                setForm({ ...form, apiConfigId: e.target.value || undefined })
              }
            >
              <option value="">使用全局默认</option>
              {form.apiConfigId &&
                !configs.some((c) => c.id === form.apiConfigId) && (
                  <option value={form.apiConfigId}>已删除的配置</option>
                )}
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.enabled ? "（已停用）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="upload avatar-upload">
            {form.avatar && (
              <img
                alt="角色头像预览"
                src={s.assets.find((a) => a.id === form.avatar)?.data}
              />
            )}
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
            <button className="primary" type="submit">
              保存角色
            </button>
          </div>
        </form>
      )}
      {profile && (
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void safeWrite(() => db.worldProfiles.put(profile)).then((ok) => {
              if (ok) setProfile(null);
            });
          }}
        >
          <h3>世界专属角色设定</h3>
          <label>
            本世界身份 / 关系 / 补充设定
            <textarea
              aria-label="世界角色设定"
              maxLength={6000}
              value={profile.setting}
              onChange={(e) =>
                setProfile({ ...profile, setting: e.target.value })
              }
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => setProfile(null)}>
              取消
            </button>
            <button className="primary">保存世界角色设定</button>
          </div>
        </form>
      )}
      {characters.map((c) => (
        <div className="card" key={c.id}>
          <div className="card-heading">
            {c.avatar && (
              <img
                className="avatar"
                alt={`${c.name}头像`}
                src={s.assets.find((a) => a.id === c.avatar)?.data}
              />
            )}
            <h3>{c.name}</h3>
          </div>
          <p className="preserve">{c.persona || "尚未填写人设"}</p>
          <div className="api-actions">
            <button onClick={() => setForm(c)}>编辑角色</button>
            {selected && (
              <button
                onClick={() =>
                  setProfile(
                    s.worldProfiles.find(
                      (p) => p.worldId === selected && p.characterId === c.id,
                    )!,
                  )
                }
              >
                编辑世界设定
              </button>
            )}
            {selected && (
              <button
                onClick={() => {
                  const p = s.worldProfiles.find(
                    (p) => p.worldId === selected && p.characterId === c.id,
                  );
                  if (
                    p &&
                    confirm(
                      "解除此世界关联？既有世界记录保留，重新关联同一角色后可继续。",
                    )
                  )
                    void safeWrite(() => db.worldProfiles.delete(p.id));
                }}
              >
                解除关联
              </button>
            )}
            <button
              className="danger"
              onClick={() => {
                if (
                  confirm(
                    `删除基础角色「${c.name}」及所有空间中的会话和世界关联？`,
                  ) &&
                  confirm("再次确认永久删除该角色及其全部聊天记录？")
                )
                  void safeWrite(() => deleteCharacter(c.id));
              }}
            >
              删除角色
            </button>
          </div>
        </div>
      ))}
      {!characters.length && !form && (
        <p className="empty">
          这里还没有角色。可以创建基础角色{selected ? "或关联已有角色" : ""}。
        </p>
      )}
    </>
  );
}

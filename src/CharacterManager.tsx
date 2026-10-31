import { useSpaces } from "./spaces";
import { Camera, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { db, safeWrite, usePhone, type Character } from "./store";
import { deleteCharacter } from "./chatService";
import type { ApiConfig } from "./api";
import type { WorldCharacterProfile } from "./chatTypes";
function CharacterAvatar({src,alt}:{src?:string;alt:string}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[src]);
  return src && !failed ? <img alt={alt} src={src} onError={()=>setFailed(true)} /> : <UserRound aria-hidden="true" size={36}/>;
}
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
    s.worlds.some((w) => w.id === s.worldId) ? s.worldId : "",
  );
  const [form, setForm] = useState<Partial<Character> | null>(null);
  const [profile, setProfile] = useState<WorldCharacterProfile | null>(null);
  const [link, setLink] = useState("");
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());
  const [editorSession,setEditorSession]=useState(0);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [avatarBusy,setAvatarBusy]=useState(false);
  const [editorError,setEditorError]=useState("");
  const mounted=useRef(true);
  const epoch=useRef(0),uploadSequence=useRef(0),saveLock=useRef(false);
  const editorRef=useRef<HTMLFormElement>(null),nameRef=useRef<HTMLInputElement>(null),avatarInput=useRef<HTMLInputElement>(null);
  const resetEditor=()=>{epoch.current++;uploadSequence.current++;setForm(null);setLoading(false);setAvatarBusy(false);setEditorError("");};
  function createCharacter(){resetEditor();setProfile(null);setForm({name:"",persona:"",speakingStyle:""});setEditorSession(epoch.current);}
  async function editCharacter(id:string){
    resetEditor();setProfile(null);setLoading(true);const ticket=epoch.current;
    try{
      const character=await db.characters.get(id);
      if(ticket!==epoch.current)return;
      if(!character){setEditorError("角色已不存在，请刷新列表后重试。");return;}
      setForm({...character,name:character.name||"",persona:character.persona||"",speakingStyle:character.speakingStyle||""});setEditorSession(ticket);
    }catch{if(ticket===epoch.current)setEditorError("无法读取角色，请检查浏览器存储后重试。");}
    finally{if(ticket===epoch.current)setLoading(false);}
  }
  async function chooseAvatar(file:File|undefined){
    if(!file || !form)return;
    setEditorError("");
    if(!file.type.startsWith("image/") || file.type==="image/svg+xml"){setEditorError("请选择 JPG、PNG、WebP 等位图图片，暂不支持 SVG 或非图片文件。");return;}
    if(file.size>20*1024*1024){setEditorError("头像图片不能超过20 MB。");return;}
    const ticket=epoch.current,request=++uploadSequence.current;let applied=false;setAvatarBusy(true);
    try{await fileChange(file,"avatar",async id=>{
      if(ticket!==epoch.current || request!==uploadSequence.current)return;
      applied=true;setForm(current=>current?{...current,avatar:id}:current);
    });if(!applied && ticket===epoch.current && request===uploadSequence.current)setEditorError("头像上传未完成。请选择可解码的位图图片，并检查本地存储空间。");}
    catch{if(ticket===epoch.current && request===uploadSequence.current)setEditorError("头像上传失败，请检查图片格式或本地存储空间。");}
    finally{if(ticket===epoch.current && request===uploadSequence.current)setAvatarBusy(false);}
  }
  useLayoutEffect(()=>{
    if(!editorRef.current)return;
    editorRef.current.scrollIntoView({block:"start",behavior:"auto"});
    nameRef.current?.focus({preventScroll:true});
  },[editorSession]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;uploadSequence.current++;};},[]);

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
          disabled={saving}
          onChange={(e) => {
            setSelected(e.target.value);
            s.set({ worldId: e.target.value });
            resetEditor();
            setExpanded(new Set());
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
        disabled={saving}
        onClick={createCharacter}
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
            onClick={() =>
              void useSpaces
                .getState()
                .enterSpace(`world:${selected}`)
                .then(() => {
                  if (useSpaces.getState().space?.worldId === selected)
                    s.set({ worldId: selected, activeApp: "世界聊天" });
                })
            }
          >
            进入世界聊天
          </button>
        </div>
      )}
      {loading && <p role="status">正在读取角色资料…</p>}
      {editorError && <p className="character-error" role="alert">{editorError}</p>}
      {form && (
        <form
          ref={editorRef}
          className="card form character-editor"
          aria-label={form.id ? "编辑角色表单" : "创建角色表单"}
          onSubmit={(e) => {
            e.preventDefault();
            if(saveLock.current || avatarBusy)return;
            saveLock.current=true;setSaving(true);setEditorError("");
            const draft={...form},ticket=epoch.current,world=selected;
            void safeWrite(() => db.transaction("rw",[db.characters,db.worlds,db.worldProfiles],async()=>{
              if(world && !(await db.worlds.get(world)))throw Error("世界不存在");
              const fields={name:draft.name!.trim(),persona:draft.persona||"",speakingStyle:draft.speakingStyle||"",avatar:draft.avatar,apiConfigId:draft.apiConfigId};
              if(draft.id){
                const current=await db.characters.get(draft.id);
                if(!current)throw Error("角色已被删除");
                await db.characters.put({...current,...fields,id:current.id});
              }else{
                const id=crypto.randomUUID();await db.characters.add({...fields,id});
                if(world)await db.worldProfiles.add({id:crypto.randomUUID(),worldId:world,characterId:id,setting:""});
              }
            })).then(ok=>{
              if(ticket!==epoch.current)return;
              if(ok){setExpanded(current=>{const next=new Set(current);if(draft.id)next.delete(draft.id);return next;});resetEditor();setSaving(false);}else setEditorError("保存未完成，请检查角色是否仍存在或浏览器存储是否可用。原有会话和关联未被重置。");
            }).finally(()=>{saveLock.current=false;if(mounted.current)setSaving(false);});
          }}
        >
          <h3>{form.id ? "编辑角色" : "新角色"}</h3>
          <p className="hint">这里修改的是共用基础资料，不是世界专属身份。</p>
          <div className="character-avatar-control">
            <button type="button" className="character-avatar-picker" aria-label={form.avatar ? "更换角色头像" : "上传角色头像"} disabled={avatarBusy||saving} onClick={()=>avatarInput.current?.click()}>
              <span className="character-avatar-preview"><CharacterAvatar src={s.assets.find(a=>a.id===form.avatar)?.data} alt="角色头像预览"/><span className="character-camera"><Camera size={20} aria-hidden="true"/></span></span>
              <span>{avatarBusy?"正在上传…":form.avatar?"点击更换头像":"点击上传头像"}</span>
            </button>
            <input ref={avatarInput} type="file" accept="image/*" aria-label="上传头像" hidden disabled={avatarBusy||saving} onChange={e=>{const file=e.target.files?.[0];e.target.value="";void chooseAvatar(file);}}/>
            {form.avatar && <button type="button" disabled={saving} onClick={()=>{uploadSequence.current++;setAvatarBusy(false);setEditorError("");setForm(current=>current?{...current,avatar:undefined}:current);}}>移除头像</button>}
          </div>
          <label>
            姓名
            <input
              ref={nameRef}
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
          <div className="actions">
            <button type="button" disabled={saving} onClick={resetEditor}>
              取消
            </button>
            <button className="primary" type="submit" disabled={saving||avatarBusy}>
              {saving ? "保存中…" : "保存角色"}
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
        <div className="card character-card" key={c.id} data-character-id={c.id}>
          <div className="card-heading">
            {c.avatar && <span className="character-list-avatar"><CharacterAvatar alt={`${c.name}头像`} src={s.assets.find(a=>a.id===c.avatar)?.data}/></span>}
            <h3>{c.name}</h3>
          </div>
          {!expanded.has(c.id) ? <p className="character-summary">{c.persona?.trim() ? c.persona : "尚未填写人设"}</p> : <div className="character-details" id={`character-details-${c.id}`} tabIndex={0} role="region" aria-label={`${c.name}完整设定`}>
            <h4>基础人设</h4><p className="preserve">{c.persona?.trim() ? c.persona : "尚未填写人设"}</p>
            <h4>基础说话方式</h4><p className="preserve">{c.speakingStyle || "尚未填写说话方式"}</p>
          </div>}
          <div className="api-actions">
            <button type="button" aria-expanded={expanded.has(c.id)} aria-controls={`character-details-${c.id}`} onClick={()=>setExpanded(current=>{const next=new Set(current);if(next.has(c.id))next.delete(c.id);else next.add(c.id);return next;})}>{expanded.has(c.id)?"收起":"展开"}</button>
            <button disabled={saving} onClick={() => void editCharacter(c.id)}>编辑角色</button>
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
              disabled={saving}
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

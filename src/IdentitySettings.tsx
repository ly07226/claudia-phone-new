import { Camera, ChevronRight, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePhone, upload } from "./store";
import { identityFor, saveIdentity, type UserIdentity } from "./userIdentity";
import type { SpaceId } from "./spaces";
export function IdentityAvatar({ avatar, name = "你" }: {avatar?: string; name?: string}) {
  const assets = usePhone(s => s.assets), src = assets.find(a => a.id === avatar)?.data;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <span className="identity-avatar">{src && !failed ? <img src={src} alt={`${name}的用户头像`} onError={() => setFailed(true)}/> : <UserRound size={32} aria-hidden="true"/>}</span>;
}
export function IdentityCard({spaceId}: {spaceId: SpaceId}) {
  const s = usePhone(), identity = identityFor(s.theme, spaceId);
  return <button className="card identity-card" aria-label="编辑用户身份" onClick={() => s.set({activeApp: "用户身份"})}>
    <IdentityAvatar avatar={identity.avatar} name={identity.name}/><span className="identity-card-info"><strong>{identity.name}</strong><span>{identity.bio || "添加你的简介"}</span></span><ChevronRight size={20}/>
  </button>;
}
export function IdentityEditor({spaceId}: {spaceId: SpaceId}) {
  const s = usePhone(), [draft, setDraft] = useState<UserIdentity>(() => identityFor(s.theme, spaceId));
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false);
  const input=useRef<HTMLInputElement>(null),alive=useRef(true),request=useRef(0),lock=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;};},[]);
  async function choose(file?:File) {
    if (!file) return;
    const ticket=++request.current;setBusy(true);setError("");
    try {const id=await upload(file,"avatar"); if(alive.current&&ticket===request.current)setDraft(current=>({...current,avatar:id}));}
    catch {if(alive.current&&ticket===request.current)setError("头像上传失败，请选择不超过20 MB的 JPG、PNG、WebP 等可解码图片，并检查存储空间。");}
    finally {if(alive.current&&ticket===request.current)setBusy(false);}
  }
  return <form className="card form identity-editor" aria-label="用户身份编辑" onSubmit={async e=>{e.preventDefault();if(lock.current||busy)return;lock.current=true;setSaving(true);setError("");try {await saveIdentity(spaceId,draft);if(alive.current)s.set({activeApp:"设置"});}catch{if(alive.current)setError("保存失败，请检查名字、本地存储及当前空间是否仍存在。原资料未被重置。");}finally{lock.current=false;if(alive.current)setSaving(false);}}}>
    <h2>用户身份</h2><p className="hint">{spaceId==="daily"?"日常手机身份":"当前剧本世界身份"} · 仅本空间使用；简介和设定不会自动加入 AI 提示词。</p>
    <div className="identity-avatar-controls"><button type="button" className="identity-picker" aria-label="上传或更换用户头像" disabled={busy||saving} onClick={()=>input.current?.click()}><IdentityAvatar avatar={draft.avatar} name={draft.name}/><span className="identity-camera"><Camera size={18}/></span></button>
      <input hidden ref={input} type="file" accept="image/*" aria-label="用户头像文件" disabled={busy||saving} onChange={e=>{const file=e.target.files?.[0];e.target.value="";void choose(file);}}/>
      {draft.avatar && <button type="button" disabled={saving} onClick={()=>{request.current++;setBusy(false);setDraft(d=>({...d,avatar:undefined}));}}>移除头像</button>}
      {busy&&<span role="status">正在处理头像…</span>}
    </div>
    <label>名字<input aria-label="用户名字" required maxLength={80} pattern=".*\S.*" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <label>简介<textarea aria-label="用户简介" maxLength={4000} value={draft.bio} onChange={e=>setDraft({...draft,bio:e.target.value})}/></label>
    <label>自定义设定<textarea aria-label="用户自定义设定" maxLength={16000} value={draft.customSetting} onChange={e=>setDraft({...draft,customSetting:e.target.value})}/></label>
    {["gender","age","occupation"].some(k=>draft[k]!==undefined)&&<details><summary>更多资料</summary>{([['gender','性别'],['age','年龄'],['occupation','职业']] as const).map(([field,label])=><label key={field}>{label}<input aria-label={`用户${label}`} value={String(draft[field]??"")} onChange={e=>setDraft({...draft,[field]:field==='age'&&typeof draft.age==='number'&&e.target.value.trim()!==''&&Number.isFinite(Number(e.target.value))?Number(e.target.value):e.target.value})}/></label>)}</details>}
    {error&&<p role="alert" className="identity-error">{error}</p>}
    <div className="actions"><button type="button" disabled={saving} onClick={()=>s.set({activeApp:"设置"})}>取消</button><button className="primary" type="submit" disabled={saving||busy}>{saving?"保存中…":"保存用户身份"}</button></div>
  </form>;
}

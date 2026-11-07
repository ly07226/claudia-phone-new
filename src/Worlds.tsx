import {continueWizardStory} from './wizardOpening';
import {WizardSetupStatus} from './WizardSetupStatus';
import {ScriptWizard} from './ScriptWizard';
import './worldInputs.css';
import {newScriptConfig} from './scriptTypes';
import {saveScriptWorld} from './scriptWorlds';
import { useState, type ReactNode } from "react";
import { Plus, Globe2 } from "lucide-react";
import { db, safeWrite, usePhone, type World } from "./store";
import { useSpaces } from "./spaces";
import { deleteWorld } from "./chatService";
export function Worlds({
  onCharacters, spaceList = false, renderSpaceActions, renderSpaceInfo, renderSpaceDetails, onEnterWorld,
}: { onCharacters?: (id: string) => void; spaceList?: boolean; renderSpaceActions?: (world: World) => ReactNode; renderSpaceInfo?: (world: World) => ReactNode; renderSpaceDetails?: (world: World) => ReactNode; onEnterWorld?: (id: string) => void } = {}) {
  const s = usePhone();
  const nav = useSpaces();
  const view = spaceList && nav.route.screen === "worlds" ? nav.route.view : undefined;
  const editId = nav.route.screen === "worlds" ? nav.route.worldId : undefined;
  const formPage = spaceList && (view === "manual" || view === "edit");

  const [form, setForm] = useState<Partial<World> | null>(() => formPage ? view === "edit" && nav.route.screen === "worlds" ? s.worlds.find(w=>w.id===editId) || null : {name:"",description:"",script:newScriptConfig()} : null);
  if (spaceList && view === "setup" && editId) return <WizardSetupStatus worldId={editId}/>;
  if (spaceList && view === "wizard") return <ScriptWizard/>;
  if (spaceList && view === "create") return <>
    <div className="page-title"><h1>新建剧本</h1><p>选择创建方式</p></div>
    <div className="script-creation-methods">
      <button onClick={() => void nav.openWorldEditor("manual")}>手动粘贴</button>
      <button onClick={() => void nav.openWorldEditor("wizard")}>AI 生成</button>
    </div>
  </>;
  if (formPage && !form) return <p role="alert">该剧本已不存在，请返回剧本列表。</p>;
  return (
    <>
      <div className="page-title">
        <span className="eyebrow">WHERE STORIES BEGIN</span>
        {spaceList ? <h1>{formPage ? view === "edit" ? "编辑剧本" : "手动创建剧本" : "剧本世界"}</h1> : <h2>世界管理</h2>}
        <p>每个世界，都有自己的故事。</p>
      </div>
      {!formPage && <button className="primary" onClick={() => {
        if(spaceList) void nav.openWorldEditor("create");
        else setForm({name:"",description:"",script:newScriptConfig()});
      }}><Plus size={17}/>{spaceList ? "新建剧本" : "创建世界"}</button>}
      {form && (
        <form
          className="card form world-config-form"
          onSubmit={(e) => {
            e.preventDefault();
            void safeWrite(() =>
              saveScriptWorld(form),
            ).then((ok) => {
              if (ok) { if(formPage) void nav.manageWorlds(true); else setForm(null); }
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
          <label>剧本玩法
            <select aria-label="剧本玩法" value={form.script?.playMode??''} onChange={e=>setForm({...form,script:e.target.value?{...(form.script??newScriptConfig()),playMode:e.target.value as 'story'|'everyday'}:undefined})}>
              {form.id&&!s.worlds.find(w=>w.id===form.id)?.script&&<option value="">保持旧世界（未配置玩法）</option>}
              <option value="story">剧情模式</option><option value="everyday">日常模式</option>
            </select>
          </label>
          {form.script&&<>
            <p className="hint">{form.script.playMode==='story'?'本阶段仅保存剧情设定，主线 App 将在后续开放；聊天功能照常使用。':'在此世界内通过聊天自然发展剧情，与独立日常聊天分区相互隔离。'}</p>
            <label>开场情境<textarea aria-label="开场情境" maxLength={6000} value={form.script.opening} onChange={e=>setForm({...form,script:{...form.script!,opening:e.target.value}})}/></label>
            {form.script.playMode==='story'&&<label>故事发展方向（可选）<textarea aria-label="故事发展方向" maxLength={4000} value={form.script.direction??''} onChange={e=>setForm({...form,script:{...form.script!,direction:e.target.value}})}/></label>}
          </>}
          <div className="actions">
            <button type="button" onClick={() => { if(formPage) void nav.exitSpace(); else setForm(null); }}>
              取消
            </button>
            <button className="primary" type="submit">
              保存世界
            </button>
          </div>
        </form>
      )}
      {!formPage && !s.worlds.length && !form && (
        <div className="empty">
          <Globe2 size={42} />
          <h3>{spaceList ? "暂无剧本" : "从一个世界开始"}</h3>
          <p>{spaceList ? "创建剧本后可关联现有角色，进入该世界手机。" : "创建世界后可关联基础角色；没有世界也可以日常聊天。"}</p>
        </div>
      )}
      {!formPage && s.worlds.map((w) => (
        <div className={spaceList ? "card space-card script-compact" : "card"} key={w.id} data-testid={spaceList ? `world-space-${w.id}` : undefined}
          onClick={spaceList && onEnterWorld ? (event) => {
            if ((event.target as Element).closest("button, a, input, textarea, select, details, .script-archives")) return;
            onEnterWorld(w.id);
          } : undefined}>
          <div className={spaceList ? "script-card-info" : undefined} style={spaceList ? undefined : {display:"contents"}}>
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
          {renderSpaceInfo?.(w)}
          </div>
          <div className={spaceList ? "script-card-actions" : undefined} style={spaceList ? undefined : {display:"contents"}}>
          {w.script?.creation && <button onClick={()=>void safeWrite(()=>continueWizardStory(w.id))}>继续开局配置</button>}
          {renderSpaceActions?.(w)}
          {spaceList && <details className="script-more"><summary aria-label={`更多 · ${w.name}`}>··· 更多</summary><div className="script-more-popup">
            <button onClick={() => onCharacters?.(w.id)}>查看角色</button>
            <button onClick={() => void nav.openWorldEditor("edit",w.id)}>编辑</button>
            <button className="danger" aria-label={`删除世界${w.name}`} onClick={() => {
              if(confirm(`删除世界「${w.name}」及其世界聊天记录和关联？基础角色与日常聊天将保留。`) && confirm("再次确认删除该世界及其全部世界会话？此操作不可撤销。")) void safeWrite(() => deleteWorld(w.id));
            }}>删除</button>
          </div></details>}
          {!spaceList && <div className="actions">
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
          </div>}
          </div>
          {renderSpaceDetails?.(w)}
        </div>
      ))}
    </>
  );
}

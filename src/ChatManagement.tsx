import { useSpaces } from "./spaces";
import { useEffect, useRef, useState } from "react";
import { MessageAvatar } from "./MessageUI";
import { ChevronLeft } from "lucide-react";
import { ConversationSearch, ConversationBackground } from "./ChatPersonalization";
import type { ChatSettingsPatch } from "./chatPreferences";
import { resolveApi } from "./chatService";
import { testConnection, type ApiConfig, type TestResult } from "./api";
import type { Conversation } from "./chatTypes";
export function ChatManagement({
  conversation,
  avatar, onPreferences, onLocate,
  name,
  worldName,
  configs,
  busy,
  onApi,
  onSnapshots,
  onDelete, onClear, onDeleteFriend,
  onSettings,
  onClose,
}: {
  conversation: Conversation;
  avatar?: string;
  onPreferences: (patch: ChatSettingsPatch) => Promise<void>;
  onLocate: (id: string) => void;
  name: string;
  worldName?: string;
  configs: ApiConfig[];
  busy: boolean;
  onApi: (id: string) => Promise<void>;
  onSnapshots: () => void;
  onDelete: () => Promise<void>;
  onClear: () => Promise<void>;
  onDeleteFriend: () => Promise<void>;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<"menu" | "info" | "api" | "remark" | "search" | "background">("menu");
  const [remark, setRemark] = useState(conversation.chatSettings?.remark || "");
  const [saving,setSaving] = useState(false);
  async function save(patch: ChatSettingsPatch) { setSaving(true);setError("");try{await onPreferences(patch);}catch{setError("设置保存失败，请检查本地存储。");}finally{setSaving(false);} }
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[onClose]);
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setTesting(false);
    setResult(null);
    setError("");
  }, [conversation.apiConfigId]);
  async function test() {
    if (testing) return;
    const c = new AbortController();
    controller.current = c;
    setSection("api");
    setTesting(true);
    setResult(null);
    setError("");
    try {
      const { config, key } = await resolveApi(conversation);
      const r = await testConnection(config, key, c.signal);
      if (!c.signal.aborted) setResult(r);
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "无法读取 API 配置。");
    } finally {
      if (controller.current === c) {
        controller.current = null;
        setTesting(false);
      }
    }
  }
  return (
    <section className="chat-settings-page" aria-label="聊天设置">
      <nav className="chat-nav"><button aria-label={section==='menu'?'返回聊天':'返回聊天设置'} onClick={()=>section==='menu'?onClose():setSection('menu')}><ChevronLeft size={24}/></button><h2 className="chat-settings-title">{({menu:'聊天设置',info:'会话信息',api:'本会话 API',remark:'修改备注',search:'搜索聊天内容',background:'设置聊天背景'})[section]}</h2><span/></nav>
      <div className="chat-settings-body">
      {section==='menu'&&<div className="chat-settings-profile"><MessageAvatar src={avatar} name={name}/><strong>{name}</strong></div>}
      {section !== "menu" && (
        <button className="text-button" onClick={() => setSection("menu")}>
          返回管理菜单
        </button>
      )}
      {section === 'remark' ? <><label className="chat-remark-label">聊天备注<input aria-label="聊天备注" value={remark} maxLength={80} onChange={e=>setRemark(e.target.value)}/></label><p className="hint">仅改变当前聊天的显示名称，不修改角色原名、人设或 AI 提示词。</p><button className="primary" disabled={saving} onClick={()=>void save({remark})}>保存备注</button><button className="text-button" disabled={saving} onClick={()=>{setRemark('');void save({remark:''});}}>清除备注</button>{error&&<p role="alert">{error}</p>}</> : section === 'search' ? <ConversationSearch id={conversation.id} onLocate={onLocate}/> : section === 'background' ? <ConversationBackground conversation={conversation} onSave={onPreferences}/> : section === "info" ? (
        <div className="conversation-info">
          <h4>{name}</h4>
          <p>
            {conversation.mode === "daily"
              ? "日常聊天 · 独立空间"
              : `世界聊天 · ${worldName || "世界不存在"}`}
          </p>
          <p>
            {conversation.mode === "daily"
              ? "此会话不读取任何世界设定或世界聊天记录。"
              : "只读取当前世界设定及本会话的有效消息，不读取日常或其他世界历史。"}
          </p>
          <p className="hint">
            记录仅保存在当前浏览器。每次发送最近最多 30 条 / 24000
            字符有效历史；API 调用可能计费。
          </p>
        </div>
      ) : section === "api" ? (
        <div className="conversation-api">
          <label className="world-select">
            本会话 API
            <select
              aria-label="本会话 API"
              disabled={busy || testing}
              value={conversation.apiConfigId || ""}
              onChange={async (e) => {
                try {
                  await onApi(e.target.value);
                  setError("");
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "会话 API 设置保存失败。",
                  );
                }
              }}
            >
              <option value="">跟随角色 / 全局默认</option>
              {conversation.apiConfigId &&
                !configs.some((c) => c.id === conversation.apiConfigId) && (
                  <option value={conversation.apiConfigId}>已删除的配置</option>
                )}
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.enabled ? "（已停用）" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            会话配置优先，其次角色指定配置，再使用全局默认。
          </p>
          <button
            className="message-action"
            disabled={testing || busy}
            onClick={() => void test()}
          >
            {testing ? "测试中…" : "API 连接测试"}
          </button>
          <p className="hint">
            使用当前解析到的配置与模型发出极短真实请求，可能计费。
          </p>
          {testing && <p role="status">正在测试连接…</p>}
          {result && <p role="status">{result.message}</p>}
          {error && <p role="alert">{error}</p>}
          <button className="message-action" onClick={onSettings}>
            打开 AI / API 设置
          </button>
        </div>
      ) : (
        <>
          <button className="message-action" onClick={()=>setSection('remark')}>修改备注</button>
          <button className="message-action" onClick={()=>setSection('search')}>搜索聊天内容</button>
          <label className="chat-setting-toggle">连续发送模式<input type="checkbox" role="switch" checked={!!conversation.chatSettings?.continuousSend} disabled={saving || busy} onChange={e=>void save({continuousSend:e.target.checked})}/></label>
          <p className="hint">开启后先保存消息，点击输入框左侧双闪光再生成回复。</p>
          <label className="chat-setting-toggle">收起键盘自动回复<input type="checkbox" role="switch" checked={!!conversation.chatSettings?.keyboardAutoReply} disabled={saving || busy || !conversation.chatSettings?.continuousSend} onChange={e=>void save({keyboardAutoReply:e.target.checked})}/></label>
          <p className="hint">连续发送消息后，收起键盘时尝试自动触发角色回复。仅连续模式生效；视口判断可能漏判或误判，失焦收起、硬件键盘等情况可能不触发，仍可手动点击双闪光。</p>
          <label className="chat-setting-toggle">置顶聊天<input type="checkbox" role="switch" checked={!!conversation.chatSettings?.pinned} disabled={saving} onChange={e=>void save({pinned:e.target.checked})}/></label>
          <label className="chat-setting-toggle">消息免打扰<input type="checkbox" role="switch" checked={!!conversation.chatSettings?.muted} disabled={saving} onChange={e=>void save({muted:e.target.checked})}/></label>
          <p className="hint">当前暂无消息通知功能；此处仅保存免打扰偏好。</p>
          <button className="message-action" onClick={()=>setSection('background')}>设置聊天背景</button>
          <button
            className="message-action"
            onClick={() => void useSpaces.getState().exitSpace()}
          >
            返回空间列表
          </button>
          <button className="message-action" onClick={() => setSection("info")}>
            会话信息
          </button>
          <button className="message-action" onClick={() => setSection("api")}>
            本会话 API 配置
          </button>
          <button
            className="message-action"
            disabled={busy}
            onClick={() => void test()}
          >
            API 连接测试
          </button>
          <button className="message-action" onClick={onSnapshots}>
            历史快照 / 分支恢复
          </button>
          <button
            className="message-action danger"
            disabled={busy}
            onClick={async () => {
              if (
                !confirm(
                  "删除当前会话及全部消息、版本、修订和快照？其他聊天空间不受影响。",
                ) ||
                !confirm("再次确认永久删除此会话？此操作不可恢复。")
              )
                return;
              try {
                await onDelete();
              } catch {
                setError("删除失败，请检查本地存储。");
              }
            }}
          >
            删除会话
          </button>
          <div className="chat-danger-actions">
            <button className="message-action danger" disabled={busy || saving} onClick={async()=>{
              if(!confirm('清空当前会话的全部消息、版本、修订和快照？保留好友、人设、头像、世界书和 API 配置。其他会话不受影响。'))return;
              if(!confirm('再次确认永久清空聊天记录？快照也将删除，此操作不可撤销。'))return;
              setSaving(true);setError('');try{await onClear();}catch{setError('清空失败，未完成操作，请检查本地存储。');}finally{setSaving(false);}
            }}>清空聊天记录</button>
            <p className="hint">当前版本没有独立长期记忆或会话摘要存储；不会删除角色人设及世界书。</p>
            {conversation.mode==='daily'&&!conversation.worldId&&<><button className="message-action danger" disabled={busy || saving} onClick={async()=>{
              if(!confirm('删除日常好友？将从日常聊天列表隐藏，保留角色资料、聊天历史、版本和世界关联。'))return;
              if(!confirm('再次确认删除好友？此操作不会清空聊天，也不会立即生成好友申请。'))return;
              setSaving(true);setError('');try{await onDeleteFriend();}catch(e){setError(e instanceof Error?e.message:'删除好友失败，请检查本地存储。');}finally{setSaving(false);}
            }}>删除好友</button><p className="hint">不影响世界聊天。重新申请由本地规则检查：删除满24小时、有基础人设及保留的双方对话；每次删除最多一次，不调用 AI。</p></>}
          </div>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </div></section>
  );
}

import { FriendRequests } from "./FriendRequests";
import { isDailyFriend, checkDailyFriendApplications, clearChatHistory, deleteDailyFriend } from "./chatRelationships";
import { orderChatCharacters, saveChatSettings, searchableMessages } from "./chatPreferences";
import { identityFor } from "./userIdentity";
import { createEnterSendGuard } from "./enterSend";
import "./chatReplyButton.css";
import "./chatTime.css";
import { chatTimeLabels } from "./chatTime";
import { Search, X } from "lucide-react";
import { liveQuery } from "dexie";
import { chatListPreviews, chatPreviewTime, type ChatPreview } from "./chatListPreview";
import { ChevronLeft, MoreHorizontal, Send, Square } from "lucide-react";
import { ChatManagement } from "./ChatManagement";
import { chatDisplayName } from "./chatPresentation";
import { useChatViewport } from "./useChatViewport";
import { useKeyboardAutoReply } from "./useKeyboardAutoReply";
import { observeComposerDebug } from "./composerDebug";
import { KeyboardDebugPanel } from "./KeyboardDebugPanel";
import { keyboardDebugEnabled, recordKeyboardDebug } from "./keyboardDebug";
import { activeMessages } from "./messagePath";
import {
  cancelGeneration,
  invalidateGeneration,
  selectVariant,
} from "./messageOperations";
import { MessageAvatar, ChatMessage, MessageTools, SnapshotTools } from "./MessageUI";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { db, usePhone } from "./store";
import type { Conversation, Message, MessageVariant } from "./chatTypes";
import type { ApiConfig } from "./api";
import {
  getConversation,
  sendMessage,
  queueUserMessage,
  deleteConversation,
  resolveApi,
  regenerateMessage,
} from "./chatService";
export function Chat({ worldId }: { worldId?: string }) {
  const s = usePhone();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const enterGuard = useRef(createEnterSendGuard());
  const [previewState, setPreviews] = useState<{scope: string; rows: Record<string, ChatPreview>}>({scope: "", rows: {}});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingMessage, setSavingMessage] = useState(false);
  const [replyPresentation,setReplyPresentation]=useState<{sequence:number;conversationId:string;known:Set<string>}|null>(null);
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [variants, setVariants] = useState<Record<string, MessageVariant[]>>(
    {},
  );
  const [menuId, setMenuId] = useState<string | null>(null);
  const [previewVariant, setPreviewVariant] = useState<
    MessageVariant | undefined
  >();
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [management, setManagement] = useState(false);
  const [requests,setRequests] = useState(false);
  const activeConversation = useRef<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const refreshTicket = useRef(0);
  const latestRefresh = useRef<Promise<void> | null>(null);
  const visiblePath = useRef<{conversationId:string;timelineId?:string;epoch:number}|null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(()=>observeComposerDebug(),[]);
  const followBottom = useRef(true);
  const onBubbleReveal=useCallback(()=>{if(followBottom.current && historyRef.current)historyRef.current.scrollTop=historyRef.current.scrollHeight;},[]);
  const preserveTop = useRef<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const taskSequence = useRef(0);
  const scrollRequested = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const world = worldId ? s.worlds.find((w) => w.id === worldId) : undefined;
  const character = s.characters.find(
    (c) => c.id === conversation?.characterId,
  );
  const displayName = conversation?.chatSettings?.remark || chatDisplayName(character);
  const savedScroll = useRef<number | null>(null);
  const jumpTo = useRef<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(()=>()=>clearTimeout(highlightTimer.current),[]);
  useLayoutEffect(()=>{
    if(management || !historyRef.current)return;
    const history=historyRef.current;
    if(jumpTo.current){const target=Array.from(history.querySelectorAll<HTMLElement>("[data-message-id]")).find(el=>el.dataset.messageId===jumpTo.current);if(target){history.scrollTop+=target.getBoundingClientRect().top-history.getBoundingClientRect().top-history.clientHeight/3;history.querySelectorAll(".chat-message-highlight").forEach(el=>el.classList.remove("chat-message-highlight"));target.classList.add("chat-message-highlight");clearTimeout(highlightTimer.current);highlightTimer.current=setTimeout(()=>target.classList.remove("chat-message-highlight"),2400);followBottom.current=false;}jumpTo.current=null;savedScroll.current=null;}
    else if(savedScroll.current!==null){history.scrollTop=savedScroll.current;savedScroll.current=null;}
  },[management]);
  const userIdentity = identityFor(s.theme, conversation?.mode === "world" ? `world:${conversation.worldId}` : "daily");
  const userAvatar = s.assets.find(a=>a.id===userIdentity.avatar)?.data;
  const avatarSrc = s.assets.find((a) => a.id === character?.avatar)?.data;
  useChatViewport(!!conversation, text, inputRef, () => {
    if (followBottom.current && historyRef.current)
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
  });
  const characters = worldId
    ? s.characters.filter((c) =>
        s.worldProfiles.some(
          (p) => p.worldId === worldId && p.characterId === c.id,
        ),
      )
    : s.characters.filter(isDailyFriend);
  const applications = !worldId ? s.characters.filter(c=>c.dailyFriendship?.status==='pending'&&c.dailyFriendship.application) : [];
  useEffect(()=>{setRequests(false);},[worldId]);
  useEffect(()=>{
    if(worldId || conversation)return;
    let active=true;
    void checkDailyFriendApplications().then(()=>{if(active)return s.reload();}).catch(()=>{if(active)setError('好友申请资格检查失败，请稍后重试。');});
    return()=>{active=false;};
  },[worldId,!!conversation]);
  const characterIds = JSON.stringify(characters.map(c => c.id));
  const previewScope = JSON.stringify([worldId ?? null, characterIds]);
  const previews = previewState.scope === previewScope ? previewState.rows : {};
  const query = search.trim().toLocaleLowerCase();
  const orderedCharacters = orderChatCharacters(characters, previews);
  const displayedCharacters = !worldId && query ? orderedCharacters.filter(c=>`${previews[c.id]?.remark || c.name} ${c.name} ${previews[c.id]?.content || ""}`.toLocaleLowerCase().includes(query)) : orderedCharacters;
  useEffect(()=>{setSearch("");enterGuard.current.reset();},[worldId]);
  useEffect(() => {
    if (conversation) return;
    setPreviews({scope: previewScope, rows: {}});
    const subscription = liveQuery(() => chatListPreviews(characters.map(c => c.id), worldId))
      .subscribe({ next: rows => setPreviews({scope: previewScope, rows}), error: () => setError("无法读取聊天预览，请稍后重试。") });
    return () => subscription.unsubscribe();
  }, [characterIds, worldId, conversation?.id]);
  async function loadSnapshot(id: string, scroll = false) {
    const ticket=++refreshTicket.current;
    const data=await db.transaction("r",[db.conversations,db.messages,db.messageVariants,db.timelines,db.pathNodes],async()=>{
    const current=await db.conversations.get(id);
    if(!current)return null;
    const rows = await activeMessages(id);
    const ids = new Set(rows.map((m) => m.id));
    const all = await db.messageVariants
      .where("conversationId")
      .equals(id)
      .filter((v) => ids.has(v.messageId))
      .toArray();
    return {current,rows,all};
    });
    if(ticket!==refreshTicket.current||!data)return;
    const {current,rows,all}=data;
    const groups: Record<string, MessageVariant[]> = {};
    for (const v of all) (groups[v.messageId] ??= []).push(v);
    for (const list of Object.values(groups))
      list.sort(
        (a, b) =>
          a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    if (mounted.current && activeConversation.current === id) {
      if(visiblePath.current?.conversationId===id && visiblePath.current.timelineId!==current.activeTimelineId && (!pending.current || pending.current.signal.aborted))setReplyPresentation(null);
      if (scroll && followBottom.current) {
        scrollRequested.current = true;
        preserveTop.current = null;
      } else preserveTop.current = historyRef.current?.scrollTop ?? null;
      visiblePath.current={conversationId:id,timelineId:current.activeTimelineId,epoch:current.timelineEpoch??0};
      setConversation(current);
      setMessages(rows);
      setVariants(groups);
    }
  }
  function refresh(id:string,scroll=false):Promise<void> {
    const completion=loadSnapshot(id,scroll).then(async()=>{const next=latestRefresh.current;if(next&&next!==completion)await next;});
    latestRefresh.current=completion;return completion;
  }
  useEffect(()=>{
    const id=conversation?.id;if(!id)return;
    const subscription=liveQuery(async()=>{const c=await db.conversations.get(id);return {c,t:c?.activeTimelineId?await db.timelines.get(c.activeTimelineId):undefined};}).subscribe({
      next:({c})=>{if(activeConversation.current!==id)return;if(!c){leaveConversation();return;}void refresh(id,followBottom.current).catch(()=>setError("时间线路径读取失败，请检查本地数据。"));},
      error:()=>setError("无法订阅当前时间线，请刷新后重试。"),
    });return()=>subscription.unsubscribe();
  },[conversation?.id]);
  useEffect(() => {
    mounted.current = true;
    void db.apiConfigs
      .toArray()
      .then(setConfigs)
      .catch(() => setError("无法读取 API 配置。"));
    return () => {
      mounted.current = false;
      ++taskSequence.current;
      pending.current?.abort();
      if (pending.current && activeConversation.current)
        cancelGeneration(activeConversation.current);
      activeConversation.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    if (scrollRequested.current) {
      history.scrollTop = history.scrollHeight;
      scrollRequested.current = false;
    } else if (preserveTop.current !== null) {
      history.scrollTop = preserveTop.current;
      preserveTop.current = null;
    }
  }, [messages, busy]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);
  async function open(id: string) {
    const navigation = ++taskSequence.current;
    setError("");
    setMessages([]);
    setReplyPresentation(null);
    try {
      if(!worldId){const current=await db.characters.get(id);if(!current||!isDailyFriend(current))throw Error("此日常好友已删除，请先处理好友申请。");}
      const c = await getConversation(id, worldId);
      if (navigation !== taskSequence.current) return;
      activeConversation.current = c.id;
      followBottom.current = true;
      setConversation(c);
      await refresh(c.id, true);
      try {
        await resolveApi(c);
      } catch (e) {
        if (navigation === taskSequence.current)
          setError(e instanceof Error ? e.message : "无法读取 API。");
      }
    } catch {
      if (navigation === taskSequence.current)
        setError("无法打开会话，请检查本地存储与角色关联。");
    }
  }
  async function runGeneration(
    retry = false,
    target?: Message,
    allowArchive = false,
    force = false,
    flow: "ordinary"|"automatic"|"manual"|"other" = "other",
  ) {
    if (!conversation || ((busy || pending.current) && !force)) {recordKeyboardDebug('generation-blocked',{flow,reason:!conversation?'no-conversation':'busy',hasConversation:!!conversation,idle:!busy,noPending:!pending.current});return;}
    recordKeyboardDebug('generation-entered',{flow,idle:!busy,noPending:!pending.current});
    recordKeyboardDebug('generation-allowed',{flow,idle:!busy,noPending:!pending.current});
    const id = conversation.id;
    const view=visiblePath.current;
    const expectedPath=view?.conversationId===id?{timelineId:view.timelineId,epoch:view.epoch}:{timelineId:conversation.activeTimelineId,epoch:conversation.timelineEpoch??0};
    if (!retry && !target) followBottom.current = true;
    const sequence = ++taskSequence.current;
    if(retry || target || !conversation.chatSettings?.continuousSend)setReplyPresentation({sequence,conversationId:id,known:new Set(messages.filter(m=>m.role==='assistant').map(m=>JSON.stringify([m.id,m.activeVariantId,m.content])))});
    const previous = pending.current;
    setSavingMessage(!retry && !target && !!conversation.chatSettings?.continuousSend);
    setBusy(true);
    setError("");
    setFeedback("");
    const controller = new AbortController();
    pending.current = controller;
    const draft = text;
    let stored = retry || !!target;
    if (!retry && !target) setText("");
    try {
      if (force) {
        previous?.abort();
        await db.transaction("rw", db.conversations, async () => {
          const current=await db.conversations.get(id);
          if(!current||current.activeTimelineId!==expectedPath.timelineId||(current.timelineEpoch??0)!==expectedPath.epoch)throw Error("剧情已在其他窗口切换，请确认后重试。");
          cancelGeneration(id);await invalidateGeneration(id);
        });
      }
      if (!retry && !target && conversation.chatSettings?.continuousSend) {
        recordKeyboardDebug('message-save-start',{flow,inputFocused:document.activeElement===inputRef.current});
        await queueUserMessage(id, draft, expectedPath);
        recordKeyboardDebug('message-save-end',{flow,success:true,inputFocused:document.activeElement===inputRef.current});
        stored = true;
        await refresh(id, true);
      } else if (target)
        await regenerateMessage(id, target.id, controller.signal, allowArchive, expectedPath);
      else {
        recordKeyboardDebug('ai-start',{flow,inputFocused:document.activeElement===inputRef.current,disabled:!!inputRef.current?.disabled});
        await sendMessage(id, draft, controller.signal, retry, async () => {
          stored = true;
          await refresh(id, true);
        }, expectedPath);
      }
      if(retry)recordKeyboardDebug('reply-returned',{success:true});
    } catch (e) {
      if(!retry&&!target&&conversation.chatSettings?.continuousSend&&!stored)recordKeyboardDebug('message-save-end',{flow,success:false,inputFocused:document.activeElement===inputRef.current});
      if(retry&&keyboardDebugEnabled())recordKeyboardDebug('reply-returned',{success:false,reason:e instanceof Error&&e.message==='此会话正在回复中，请稍候。'?'service-lock':e instanceof Error&&e.message==='剧情已在其他窗口切换，请确认当前消息后重试。'?'service-path':e instanceof Error&&e.message==='没有可重试的用户消息。'?'service-no-pending':'generation-failed'});
      if (mounted.current && sequence === taskSequence.current) {
        if (!stored && !retry && !target) setText(draft);
        setError(
          e instanceof Error ? e.message : "请求失败，已保存消息仍保留。",
        );
      }
      if (force) throw e;
    } finally {
      if (mounted.current && sequence === taskSequence.current) {
        await refresh(id, !target).catch(() =>
          setError("无法读取聊天记录，请检查存储空间。"),
        );
        setBusy(false);
        setSavingMessage(false);
        pending.current = null;
      }
    }
  }
  const send = (retry = false, origin: "automatic"|"manual" = "manual") => {
    const flow=retry?origin:"ordinary";
    if(!retry)recordKeyboardDebug('send-start',{flow,inputFocused:document.activeElement===inputRef.current,idle:!busy,noPending:!pending.current});
    if(retry)recordKeyboardDebug('send-true',{flow,hasConversation:!!conversation,idle:!busy,noPending:!pending.current});
    if(retry)keyboardAutoReply.cancel();
    if (!retry && (!text.trim() || busy || pending.current)) return Promise.resolve();
    if(!retry)keyboardAutoReply.suppressSend();
    return runGeneration(retry,undefined,false,false,flow);
  };
  const keyboardAutoReply=useKeyboardAutoReply(inputRef,{
    conversationId:conversation?.id,
    identity:JSON.stringify([worldId,conversation?.id,conversation?.characterId]),
    epoch:conversation?.timelineEpoch??0,
    initialTimeline:!conversation?.activeTimelineId,
    savingMessage,
    scope:JSON.stringify([worldId,conversation?.id,conversation?.characterId,conversation?.activeTimelineId,conversation?.timelineEpoch]),
    enabled:!!conversation?.chatSettings?.continuousSend&&!!conversation?.chatSettings?.keyboardAutoReply,
    blocked:management||!!menuId||!!previewVariant||showSnapshots||requests||(busy&&!savingMessage),
    canReply:()=>{
      const ready=!!conversation&&activeConversation.current===conversation.id&&visiblePath.current?.conversationId===conversation.id&&visiblePath.current.timelineId===conversation.activeTimelineId&&visiblePath.current.epoch===(conversation.timelineEpoch??0)&&!busy&&!pending.current&&messages.at(-1)?.role==='user';
      if(keyboardDebugEnabled())recordKeyboardDebug('reply-check',{canReply:ready,hasConversation:!!conversation,currentConversation:activeConversation.current===conversation?.id,pathConversation:visiblePath.current?.conversationId===conversation?.id,pathTimeline:visiblePath.current?.timelineId===conversation?.activeTimelineId,pathEpoch:visiblePath.current?.epoch===(conversation?.timelineEpoch??0),idle:!busy,noPending:!pending.current,pendingUser:messages.at(-1)?.role==='user'});
      return ready;
    },
    reply:()=>{void send(true,"automatic");},
  });
  const onGenerate = (message?: Message, allowArchive = false) =>
    runGeneration(true, message, allowArchive, true);
  async function chooseVariant(m: Message, v: MessageVariant) {
    setReplyPresentation(null);
    if (v.id === m.activeVariantId) return;
    if (messages.findIndex((row) => row.id === m.id) < messages.length - 1) {
      setPreviewVariant(v);
      setMenuId(m.id);
      return;
    }
    try {
      await selectVariant(conversation!.id, m.id, v.id);
      await refresh(conversation!.id);
      setFeedback("已切换回复版本。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "版本切换失败。");
    }
  }
  function leaveConversation() {
    setReplyPresentation(null);
    taskSequence.current++;
    activeConversation.current = null;
    visiblePath.current=null;
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setSavingMessage(false);
    setConversation(null);
    setMessages([]);
    setText("");
    setError("");
    setFeedback("");
    setManagement(false);
    setMenuId(null);
    setShowSnapshots(false);
  }
  const timeLabels=chatTimeLabels(messages);
  if(requests && !worldId && !conversation)return <FriendRequests characters={applications} onClose={()=>setRequests(false)}/>;
  return (
    <div className={`chat-app ${conversation ? "chat-immersive" : ""} ${conversation?.chatSettings?.background ? 'chat-custom-background' : ''}`} style={conversation?.chatSettings?.background?.kind==='color'?{background:conversation.chatSettings.background.color}:conversation?.chatSettings?.background?.kind==='image'?{backgroundImage:`linear-gradient(rgba(243,245,236,.4),rgba(243,245,236,.4)),url("${s.assets.find(a=>a.id===(conversation.chatSettings?.background?.kind==='image'?conversation.chatSettings.background.assetId:undefined))?.data || ''}")`,backgroundSize:'cover',backgroundPosition:'center'}:undefined}>
      {!conversation && <h2 className="chat-list-title">聊天</h2>}
      {!conversation && !worldId && <label className="chat-search"><Search size={20} aria-hidden="true"/><input type="search" aria-label="搜索聊天" placeholder="搜索聊天…" value={search} onChange={e=>setSearch(e.target.value)} autoComplete="off"/>{search && <button type="button" aria-label="清空聊天搜索" onClick={()=>setSearch("")}><X size={18}/></button>}</label>}
      {!conversation && !worldId && applications.length>0 && <button className="friend-requests-entry" onClick={()=>setRequests(true)}>新的好友申请 <span>{applications.length}</span></button>}
      {!conversation && worldId && <p className="chat-world-caption">世界聊天 · {world?.name || "世界不存在"}</p>}
      {!conversation ? (
        <>
          {displayedCharacters.map((c) => (
            <button
              className="chat-list-row"
              aria-label={`${previews[c.id]?.remark || c.name} 开始 / 继续聊天`}
              key={c.id}
              onClick={() => void open(c.id)}
            >
              <MessageAvatar src={s.assets.find(a => a.id === c.avatar)?.data} name={c.name}/>
              <span className="chat-list-info"><strong>{previews[c.id]?.remark || c.name}{previews[c.id]?.pinned && <small className="chat-pinned-label"> · 置顶</small>}</strong><span className="chat-list-preview">{previews[c.id]?.content || "开始聊天"}</span></span>
              {previews[c.id]?.createdAt !== undefined && <time dateTime={new Date(previews[c.id].createdAt!).toISOString()}>{chatPreviewTime(previews[c.id].createdAt!)}</time>}
            </button>
          ))}
          {!!characters.length && !displayedCharacters.length && <p className="empty">没有匹配的聊天</p>}
          {!characters.length && (
            <div className="card">
              <p>
                {worldId
                  ? "请先在此世界关联角色。"
                  : s.characters.length ? "暂无日常好友。已删除好友的角色资料和历史仍保留，不会自动恢复关系。" : "还没有角色。无需创建世界即可创建基础角色并开始日常聊天。"}
              </p>
              <button
                className="primary"
                onClick={() => s.set({ activeApp: "角色管理" })}
              >
                管理角色
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="chat-view" hidden={management}>
          <nav className="chat-nav" aria-label="当前会话导航">
            <button aria-label="返回角色列表" onClick={leaveConversation}>
              <ChevronLeft size={24} />
            </button>
            <span
              className="chat-nav-title"
              role="heading"
              aria-level={1}
              title={displayName}
            >
              {displayName}
            </span>
            <button aria-label="会话管理" onClick={() => {setReplyPresentation(null);savedScroll.current=historyRef.current?.scrollTop ?? 0;setManagement(true);}}>
              <MoreHorizontal size={23} />
            </button>
          </nav>
          <div
            ref={historyRef}
            className="chat-history"
            aria-label="当前会话消息"
            onScroll={(e) => {
              const el = e.currentTarget;
              followBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 64;
            }}
          >
            {!messages.length && (
              <p className="hint">这是一个独立会话。说一句话，开始新的交流。</p>
            )}
            {messages.map((m) => (
              <Fragment key={m.id}>
              {timeLabels.has(m.id)&&<div className="chat-time-divider" data-chat-time-for={m.id}><time dateTime={new Date(m.createdAt).toISOString()}>{timeLabels.get(m.id)}</time></div>}
              <ChatMessage
                message={m}
                playbackKey={replyPresentation?.conversationId===conversation.id && m.role==='assistant' && !replyPresentation.known.has(JSON.stringify([m.id,m.activeVariantId,m.content])) ? `${replyPresentation.sequence}:${m.id}:${m.activeVariantId??''}` : undefined}
                onReveal={onBubbleReveal}
                variants={variants[m.id] || []}
                characterName={displayName}
                characterAvatar={avatarSrc}
                userAvatar={userAvatar}
                userName={userIdentity.name}
                onMenu={() => {
                  setReplyPresentation(null);
                  setPreviewVariant(undefined);
                  setMenuId(m.id);
                }}
                onVersion={(v) => void chooseVariant(m, v)}
              />
              </Fragment>
            ))}
            {busy && <p role="status">正在回复…</p>}
            <div ref={bottom} />
          </div>
          <div className="chat-footer">
            {feedback && (
              <p role="status" className="chat-feedback">
                {feedback}
              </p>
            )}
            {error && (
              <div className="chat-error" role="alert">
                <button
                  className="chat-error-dismiss"
                  aria-label="关闭聊天错误"
                  onClick={() => setError("")}
                >
                  ×
                </button>
                {error}
                <button onClick={() => s.set({ activeApp: "AI / API 设置" })}>
                  打开 AI / API 设置
                </button>
              </div>
            )}
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {conversation.chatSettings?.continuousSend && <button className="chat-reply-button" type="button" aria-label="AI 回复" title="让 AI 回复待回复消息" disabled={busy || messages.at(-1)?.role!=="user"} onClick={()=>void send(true)}><span aria-hidden="true">AI 回复</span><svg width={24} height={24} viewBox="0 0 24 24" fill="none" data-icon="double-sparkle" aria-hidden="true"><path d="M9.5 6 11.8 11.7 17.5 14 11.8 16.3 9.5 22 7.2 16.3 1.5 14 7.2 11.7Z" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round"/><path d="M19 1l1.2 3.3L23.5 5.5l-3.3 1.2L19 10l-1.2-3.3-3.3-1.2 3.3-1.2Z" fill="currentColor"/></svg></button>}
              <textarea
                ref={inputRef}
                rows={1}
                aria-label="聊天消息"
                placeholder="说点什么…"
                enterKeyHint={conversation.chatSettings?.continuousSend ? "send" : undefined}
                maxLength={8000}
                value={text}
                disabled={busy && !savingMessage}
                onChange={(e) => setText(e.target.value)}
                onCompositionStart={()=>enterGuard.current.start()}
                onCompositionEnd={()=>enterGuard.current.end()}
                onKeyUp={e=>enterGuard.current.up(e.key)}
                onBlur={()=>enterGuard.current.reset()}
                onKeyDown={e=>{const action=enterGuard.current.key(e.nativeEvent);if(action==='send'||action==='block')e.preventDefault();if(action==='send')void send();}}
              />
              <button
                className={`primary chat-send ${busy ? "is-cancel" : ""}`}
                type={busy ? "button" : "submit"}
                aria-label={busy ? "取消请求" : "发送"}
                disabled={!busy && !text.trim()}
                onPointerDown={e=>{if(conversation.chatSettings?.continuousSend && document.activeElement===inputRef.current)e.preventDefault();}}
                onMouseDown={e=>{if(conversation.chatSettings?.continuousSend && document.activeElement===inputRef.current)e.preventDefault();}}
                onClick={busy ? () => pending.current?.abort() : undefined}
              >
                {busy ? <Square size={18} /> : <Send size={20} />}
              </button>
            </form>
            {!busy && !conversation.chatSettings?.continuousSend && messages.at(-1)?.role === "user" && (
              <button
                className="text-button chat-retry"
                onClick={() => void send(true)}
              >
                重试最后一条消息
              </button>
            )}
          </div>
          </div>
          {menuId && (
            <MessageTools
              key={`${menuId}-${previewVariant?.id || "active"}`}
              message={messages.find((m) => m.id === menuId) || null}
              conversationId={conversation.id}
              messages={messages}
              preview={previewVariant}
              onClose={() => {
                setMenuId(null);
                setPreviewVariant(undefined);
              }}
              onRefresh={() => refresh(conversation.id)}
              onError={setError}
              onGenerate={onGenerate}
              onDraft={setText}
            />
          )}
          {showSnapshots && (
            <SnapshotTools
              conversationId={conversation.id}
              onClose={() => setShowSnapshots(false)}
              onRefresh={() => refresh(conversation.id)}
            />
          )}
          {management && (
            <ChatManagement
              conversation={conversation}
              name={displayName}
              avatar={avatarSrc}
              onPreferences={async patch=>{const next=await saveChatSettings(conversation.id,patch);if(activeConversation.current===next.id)setConversation(next);}}
              onLocate={id=>{void searchableMessages(conversation.id).then(rows=>{if(activeConversation.current!==conversation.id)return;if(!rows.some(m=>m.id===id)){setError('该消息已不在当前有效分支。');return;}jumpTo.current=id;setManagement(false);}).catch(()=>setError('无法定位消息，请稍后重试。'));}}
              worldName={
                s.worlds.find((w) => w.id === conversation.worldId)?.name
              }
              configs={configs}
              busy={busy}
              onClose={() => setManagement(false)}
              onSettings={() => s.set({ activeApp: "AI / API 设置" })}
              onSnapshots={() => {
                setManagement(false);
                setShowSnapshots(true);
              }}
              onClear={async()=>{
                const id=conversation.id;
                await clearChatHistory(id);
                if(activeConversation.current!==id)return;
                pending.current?.abort();setBusy(false);setMenuId(null);setShowSnapshots(false);setPreviewVariant(undefined);setError('');
                jumpTo.current=null;savedScroll.current=0;followBottom.current=true;
                await refresh(id);setManagement(false);setFeedback('当前会话记录已清空，好友及角色资料保留。');
              }}
              onDeleteFriend={async()=>{
                const id=conversation.id;await deleteDailyFriend(id);await s.reload();
                if(activeConversation.current===id)leaveConversation();
              }}
              onDelete={async () => {
                const id = conversation.id;
                await deleteConversation(id);
                if (activeConversation.current === id) leaveConversation();
              }}
              onApi={async (id) => {
                const next = { ...conversation, apiConfigId: id || undefined };
                await db.conversations.update(conversation.id, {
                  apiConfigId: next.apiConfigId,
                });
                if (activeConversation.current === next.id)
                  setConversation(next);
                try {
                  await resolveApi(next);
                  if (activeConversation.current === next.id) setError("");
                } catch (e) {
                  throw Error(e instanceof Error ? e.message : "API 不可用。");
                }
              }}
            />
          )}
        </>
      )}
      {error && !conversation && <p role="alert">{error}</p>}
      <KeyboardDebugPanel/>
    </div>
  );
}

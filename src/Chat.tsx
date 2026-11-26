import {useChatHistoryWindow} from './useChatHistoryWindow';
import {dataEqual} from './dataEqual';
import {chatDataRevision} from './chatDataRevision';
import {cloudConfigured,cloudFunctionRequest,hasCloudIdentity} from './cloudIdentity';
import type {CSSProperties} from 'react';
import {ChatHub} from './ChatHub';
import {takeChatOpen,openChatEvent,markVisibleChat} from './chatNotificationNavigation';
import {interruptionLabel,validInterruption} from './chatCompletion';
import {ReplyPending,ReplyFailureNotice} from './ReplyStatus';
import {prepareQuote,quoteSummary} from './messageReferences';
import {partKey,type BubblePart} from './messageBubbles';
import type {MessageSelection} from './MessagePopover';
import {useGenerationTask, useGenerationFailures, getGenerationTask, retainGenerationFailure, startGenerationTask, stopGenerationTask, runningTask} from "./generationTasks";
import { AttachmentMenu, StoredImage, useImageDraft } from "./ImageAttachments";
import {listQqCloudBindings,newestQqBinding} from "./qqQrLogin";
import {syncQqDailyConversation} from "./qqDailySync";
import { FriendRequests } from "./FriendRequests";
import { isDailyFriend, checkDailyFriendApplications, clearChatHistory, deleteDailyFriend } from "./chatRelationships";
import { orderChatCharacters, saveChatSettings, searchableMessages } from "./chatPreferences";
import { identityFor } from "./userIdentity";
import { createEnterSendGuard } from "./enterSend";
import "./chatReplyButton.css";
import "./chatTime.css";
import "./chatHistoryCapsule.css";
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
import { ConversationLayoutDebug } from "./ConversationLayoutDebug";
import { keyboardDebugEnabled, recordKeyboardDebug } from "./keyboardDebug";
import { activeMessages } from "./messagePath";
import { readTimelineDisplayPage } from "./timelines";
import {
  cancelGeneration,
  invalidateGeneration,
  selectVariant,
} from "./messageOperations";
import { MessageAvatar, ChatMessage, MessageTools, SnapshotTools } from "./MessageUI";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { db, usePhone } from "./store";
import type { Conversation, Message, MessageVariant, MessageQuote } from "./chatTypes";
import type { ApiConfig } from "./api";
import {
  getConversation,
  queueUserMessage,
  deleteConversation,
  resolveApi,
} from "./chatService";
const noVariants:MessageVariant[]=[];
export function Chat({ worldId }: { worldId?: string }) {
  const s = usePhone();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // Only an already opted-in cloud device reports foreground chat presence.
  // No login prompt, no automatic anonymous signup for ordinary local chats.
  useEffect(()=>{
    const id=conversation?.id;
    if(!id||!cloudConfigured()||!hasCloudIdentity())return;
    let alive=true;
    const report=(visible:boolean)=>{
      if(!alive||!navigator.onLine)return;
      void cloudFunctionRequest('claudia-chat-presence','POST',{conversationId:id,visible}).catch(()=>{});
    };
    const sync=()=>report(document.visibilityState==='visible'&&document.hasFocus());
    sync();
    const timer=window.setInterval(sync,15000);
    const hide=()=>report(false);
    document.addEventListener('visibilitychange',sync);
    window.addEventListener('focus',sync);
    window.addEventListener('blur',hide);
    window.addEventListener('pagehide',hide);
    return ()=>{
      // Best effort; the server also treats heartbeats older than 30s as stale.
      report(false);alive=false;window.clearInterval(timer);
      document.removeEventListener('visibilitychange',sync);
      window.removeEventListener('focus',sync);
      window.removeEventListener('blur',hide);
      window.removeEventListener('pagehide',hide);
    };
  },[conversation?.id]);

  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const enterGuard = useRef(createEnterSendGuard());
  const [previewState, setPreviews] = useState<{scope: string; rows: Record<string, ChatPreview>}>({scope: "", rows: {}});
  const [error, setError] = useState("");
  const [localBusy, setBusy] = useState(false);
  const generationTask=useGenerationTask(conversation?.id);
  const [leaseClock,setLeaseClock]=useState(Date.now());
  const remotePending=!!conversation?.sendingToken&&!runningTask(generationTask)&&(conversation.sendingUntil??0)>leaseClock;
  const busy=localBusy||runningTask(generationTask)||remotePending;
  const taskMatches=!!conversation&&generationTask?.timelineId===conversation.activeTimelineId&&generationTask?.epoch===(conversation.timelineEpoch??0);
  const failedTasks=useGenerationFailures(conversation?.id);
  const visibleFailures=useMemo(()=>{
    const ids=new Set(messages.map(m=>m.id));
    return failedTasks.filter(f=>f.timelineId===conversation?.activeTimelineId&&f.epoch===(conversation?.timelineEpoch??0)&&(!f.messageId||ids.has(f.messageId)));
  },[failedTasks,conversation?.activeTimelineId,conversation?.timelineEpoch,messages]);
  const failuresByMessage=useMemo(()=>{
    const groups=new Map<string,typeof visibleFailures>();
    for(const f of visibleFailures)if(f.messageId){const list=groups.get(f.messageId)||[];list.push(f);groups.set(f.messageId,list);}
    return groups;
  },[visibleFailures]);
  useEffect(()=>{setLeaseClock(Date.now());const until=conversation?.sendingUntil;if(!until)return;const timer=setTimeout(()=>setLeaseClock(Date.now()),Math.max(0,until-Date.now()+1));return()=>clearTimeout(timer);},[conversation?.id,conversation?.sendingToken,conversation?.sendingUntil]);
  const [savingMessage, setSavingMessage] = useState(false);
  const [attachmentOpen,setAttachmentOpen]=useState(false);
  const [qqManualSyncBusy,setQqManualSyncBusy]=useState(false);
  const manualQqSync=async()=>{
    const target=conversation;
    const stableId=localStorage.getItem('claudia-qq-stable-sync-id');
    if(!target||target.mode!=='daily'||target.worldId||!stableId){setError('请先在 QQ 设置中确认绑定固定用户 ID');return;}
    if(qqManualSyncBusy)return;
    setQqManualSyncBusy(true);setError('');
    try{
      const bindings=await listQqCloudBindings();
      const matching=bindings.filter(b=>b.status==='connected'&&b.character_id===target.characterId&&b.stable_sync_id===stableId);
      const latest=newestQqBinding(matching);
      if(!latest)throw Error('此角色尚未确认 QQ 绑定');
      const added=await syncQqDailyConversation(target.id,latest.id,true);
      if(added>0)await refresh(target.id,true);
      window.alert(added>0?'QQ 记录本次新增 '+added+' 条消息；如仍有历史积压，前台自动同步会继续处理。':'本次没有导入新消息。可能已同步过，或同步断点之后没有新记录；云端历史数量不等于本次新增数量。');
    }catch(e){setError(e instanceof Error?e.message:'QQ 记录同步失败');}
    finally{setQqManualSyncBusy(false);}
  };
  const imageDraft=useImageDraft(conversation,text,setText,setError);
  const [replyPresentation,setReplyPresentation]=useState<{sequence:number;conversationId:string;known:Map<string,Message>}|null>(null);
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [variants, setVariants] = useState<Record<string, MessageVariant[]>>(
    {},
  );
  const [menuId, setMenuId] = useState<string | null>(null);
  const [selection,setSelection]=useState<MessageSelection>();
  const [menuPath,setMenuPath]=useState<import('./chatService').ExpectedPath>();
  const [replyTo,setReplyTo]=useState<MessageQuote|null>(null);
  useEffect(()=>{setReplyTo(q=>q&&(!conversation||q.conversationId!==conversation.id||q.epoch!==(conversation.timelineEpoch??0)||(conversation.activeTimelineId&&q.timelineId!==conversation.activeTimelineId))?null:q);},[conversation?.id,conversation?.activeTimelineId,conversation?.timelineEpoch]);
  const [previewVariant, setPreviewVariant] = useState<
    MessageVariant | undefined
  >();
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [management, setManagement] = useState(false);
  const [requests,setRequests] = useState(false);
  useEffect(()=>{if(menuId&&!messages.some(m=>m.id===menuId)){setMenuId(null);setSelection(undefined);setPreviewVariant(undefined);}},[menuId,messages]);
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
  const historyWindow=useChatHistoryWindow(messages,historyRef,conversation?.id,followBottom);
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
    if(jumpTo.current){
      const targetId=jumpTo.current;
      const index=messages.findIndex(m=>m.id===targetId);
      if(index>=0&&(index<historyWindow.start||index>=historyWindow.end)){
        followBottom.current=false;
        historyWindow.reveal(index);
        return;
      }
      const target=Array.from(history.querySelectorAll<HTMLElement>("[data-message-id]")).find(el=>el.dataset.messageId===targetId);
      if(target){history.scrollTop+=target.getBoundingClientRect().top-history.getBoundingClientRect().top-history.clientHeight/3;history.querySelectorAll(".chat-message-highlight").forEach(el=>el.classList.remove("chat-message-highlight"));target.classList.add("chat-message-highlight");clearTimeout(highlightTimer.current);highlightTimer.current=setTimeout(()=>target.classList.remove("chat-message-highlight"),2400);followBottom.current=false;}
      jumpTo.current=null;savedScroll.current=null;
    }
    else if(savedScroll.current!==null){history.scrollTop=savedScroll.current;savedScroll.current=null;}
  },[management,historyWindow.start,historyWindow.end,messages]);
  const pendingQuoteJump=useRef<{id:string;part:BubblePart}|null>(null);
  function locateQuote(id:string,part:BubblePart){
    if(!messages.some(m=>m.id===id)&&displayHasMore.current){
     pendingQuoteJump.current={id,part};
     void revealFullHistory(activeConversation.current!).catch(()=>{pendingQuoteJump.current=null;setFeedback('无法定位原消息。');});
     return;
    }
    const index=messages.findIndex(m=>m.id===id);
    if(index<0){setFeedback('原消息已删除或不在当前分支。');return;}
    if(index<historyWindow.start||index>=historyWindow.end){
      pendingQuoteJump.current={id,part};
      followBottom.current=false;
      historyWindow.reveal(index);
      return;
    }
    scrollToQuote(id,part);
  }
  function scrollToQuote(id:string,part:BubblePart){
    const history=historyRef.current;if(!history)return;
    const group=Array.from(history.querySelectorAll<HTMLElement>('[data-message-id]')).find(el=>el.dataset.messageId===id);
    const target=group&&Array.from(group.querySelectorAll<HTMLElement>('[data-bubble-key]')).find(el=>el.dataset.bubbleKey===partKey(part));
    if(!target){setFeedback('无法定位引用消息。');return;}
    followBottom.current=false;scrollRequested.current=false;preserveTop.current=null;
    history.scrollTop+=target.getBoundingClientRect().top-history.getBoundingClientRect().top-history.clientHeight/3;
    history.querySelectorAll('.chat-message-highlight').forEach(el=>el.classList.remove('chat-message-highlight'));target.classList.add('chat-message-highlight');clearTimeout(highlightTimer.current);highlightTimer.current=setTimeout(()=>target.classList.remove('chat-message-highlight'),2400);
  }
  useLayoutEffect(()=>{
    const target=pendingQuoteJump.current;
    if(!target)return;
    const index=messages.findIndex(m=>m.id===target.id);
    if(index<0)return; // Wait for the asynchronously loaded target.
    if(index<historyWindow.start||index>=historyWindow.end){
      followBottom.current=false;
      historyWindow.reveal(index);
      return;
    }
    pendingQuoteJump.current=null;
    scrollToQuote(target.id,target.part);
  },[messages,historyWindow.start,historyWindow.end]);
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
  useEffect(()=>{const handle=()=>{const target=takeChatOpen(worldId);if(target)void open(target.characterId);};handle();window.addEventListener(openChatEvent,handle);return()=>window.removeEventListener(openChatEvent,handle);},[worldId]);
  useEffect(()=>conversation?markVisibleChat(conversation.id):undefined,[conversation?.id]);
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
  const appliedSnapshot=useRef<{key:string;revision:number;rows:Message[]}|null>(null);
  const displayCursor=useRef<string|undefined>(undefined);
  const displayHasMore=useRef(false);
  const displayPaging=useRef(false);
  const displayFullyLoaded=useRef(false);
  async function loadOlderDisplayMessages(){
   const id=activeConversation.current;
   if(!id||displayPaging.current||!displayHasMore.current||displayFullyLoaded.current)return;
   displayPaging.current=true;
   const scope=visiblePath.current;
   const cursor=displayCursor.current;
   const ticket=refreshTicket.current;
   const previousKey=appliedSnapshot.current?.key;
   try{
    const page=await readTimelineDisplayPage(id,120,cursor);
    if(activeConversation.current!==id||visiblePath.current?.timelineId!==scope?.timelineId||visiblePath.current?.epoch!==scope?.epoch||displayFullyLoaded.current||displayCursor.current!==cursor||refreshTicket.current!==ticket||appliedSnapshot.current?.key!==previousKey)return;
    displayCursor.current=page.nextCursor;
    displayHasMore.current=page.hasMore;
    if(!page.rows.length)return;
    // Let the virtualized history anchor the first visible bubble before
    // prepending. Scroll-height arithmetic races React layout on iOS.
    historyWindow.beforeChange();
    const previousRows=appliedSnapshot.current?.rows??[];
    const existing=new Set(previousRows.map(m=>m.id));
    const combined=[...page.rows.filter(m=>!existing.has(m.id)),...previousRows];
    if(appliedSnapshot.current)appliedSnapshot.current={...appliedSnapshot.current,rows:combined};
    setMessages(combined);
   }catch{if(activeConversation.current===id)setError('读取更早消息失败，请重试。');}
   finally{displayPaging.current=false;}
  }
  async function revealFullHistory(id:string){
   if(displayFullyLoaded.current)return;
   const scope=visiblePath.current;
   const rows=await activeMessages(id,undefined,true);
   if(activeConversation.current!==id||visiblePath.current?.timelineId!==scope?.timelineId||visiblePath.current?.epoch!==scope?.epoch)return;
   displayFullyLoaded.current=true;
   displayHasMore.current=false;
   displayCursor.current=undefined;
   historyWindow.beforeChange();
   setMessages(rows);
  }
  async function loadSnapshot(id:string,scroll=false){
   const ticket=++refreshTicket.current,revision=chatDataRevision();const previous=appliedSnapshot.current;
   const data=await db.transaction('r',[db.conversations,db.messages,db.messageVariants,db.timelines,db.pathNodes],async()=>{const current=await db.conversations.get(id);if(!current)return null;const timeline=current.activeTimelineId?await db.timelines.get(current.activeTimelineId):undefined;
    const key=JSON.stringify([db.name,id,current.activeTimelineId,current.timelineEpoch,timeline?.headNodeId,timeline?.revision]);
    if(previous?.key===key&&previous.revision===revision)return {current,key,rows:previous.rows};
    const page=displayFullyLoaded.current?null:await readTimelineDisplayPage(id,120);
    const incoming=page?page.rows:await activeMessages(id,undefined,true);
    const old=new Map(previous?.rows.map(m=>[m.id,m])??[]);
    const rows=incoming.map(m=>{const before=old.get(m.id);return before&&dataEqual(before,m)?before:m;});
    if(page){
     // Keep previously loaded older pages when new messages arrive on the
     // same timeline. Do not merge across a branch switch.
     if(previous?.key&&JSON.parse(previous.key)[2]===current.activeTimelineId&&JSON.parse(previous.key)[3]===current.timelineEpoch){
      // A timeline revision can edit/delete any older message. Retaining
      // previously loaded pages here would display stale or removed bubbles.
      // Preserve older pages only when the source revision has not changed.
      if(previous.revision===revision){
       const seen=new Set(rows.map(m=>m.id));
       const older=previous.rows.filter(m=>!seen.has(m.id));
       return {current,key,rows:[...older,...rows],page};
      }
     }
     return {current,key,rows,page};
    }
    return {current,key,rows:previous&&rows.length===previous.rows.length&&rows.every((m,i)=>m===previous.rows[i])?previous.rows:rows};
   });if(ticket!==refreshTicket.current||!data||!mounted.current||activeConversation.current!==id)return;
   const {current,key,rows}=data;
   if('page' in data&&data.page){
    // A head refresh must not rewind the paging cursor after older pages
    // were loaded. Reset only on an actual timeline/epoch change.
    const samePath=!!previous?.key&&JSON.parse(previous.key)[2]===current.activeTimelineId&&JSON.parse(previous.key)[3]===current.timelineEpoch;
    if(!samePath||previous?.revision!==revision||!displayCursor.current){
     displayCursor.current=data.page.nextCursor;
     displayHasMore.current=data.page.hasMore;
    }
   }
   if(visiblePath.current?.conversationId===id&&visiblePath.current.timelineId!==current.activeTimelineId&&(!pending.current||pending.current.signal.aborted))setReplyPresentation(null);
   visiblePath.current={conversationId:id,timelineId:current.activeTimelineId,epoch:current.timelineEpoch??0};
   setConversation(before=>dataEqual(before,current)?before:current);
   appliedSnapshot.current={key,revision,rows};if(previous?.rows===rows)return;
   historyWindow.beforeChange();preserveTop.current=null;if(scroll&&followBottom.current)scrollRequested.current=true;
   setMessages(rows);
  }
  function refresh(id:string,scroll=false):Promise<void> {
    const completion=loadSnapshot(id,scroll).then(async()=>{const next=latestRefresh.current;if(next&&next!==completion)await next;});
    latestRefresh.current=completion;return completion;
  }
  useEffect(()=>{
    const id=conversation?.id;if(!id)return;
    const subscription=liveQuery(async()=>{const c=await db.conversations.get(id);return {c,t:c?.activeTimelineId?await db.timelines.get(c.activeTimelineId):undefined};}).subscribe({
      next:({c})=>{if(activeConversation.current!==id)return;if(!c){leaveConversation();return;}void refresh(id,followBottom.current).catch(()=>{if(activeConversation.current===id)setError("时间线路径读取失败，请检查本地数据。");});},
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
      // Navigation detaches this view; the application task retains its request.
      pending.current = null;
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
    appliedSnapshot.current=null;
    displayFullyLoaded.current=false;
    displayHasMore.current=false;
    displayCursor.current=undefined;
    pendingQuoteJump.current=null;
    setMessages([]);
    setBusy(false);setSavingMessage(false);pending.current=null;setReplyTo(null);
    setReplyPresentation(null);
    try {
      if(!worldId){const current=await db.characters.get(id);if(!current||!isDailyFriend(current))throw Error("此日常好友已删除，请先处理好友申请。");}
      const c = await getConversation(id, worldId);
      if (navigation !== taskSequence.current) return;
      activeConversation.current = c.id;
      if(c.chatSettings?.proactiveUnreadAt)void db.conversations.update(c.id,{chatSettings:{...c.chatSettings,proactiveUnreadAt:undefined}});
      followBottom.current = true;
      // Enter the conversation shell immediately. Waiting for the complete
      // timeline read here made the contact appear unresponsive on long chats.
      // Keep the existing snapshot loader as the source of visible messages;
      // this does not truncate stored history or change generation context.
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
    const ownsView=()=>mounted.current&&activeConversation.current===id&&sequence===taskSequence.current;
    if(retry || target || !conversation.chatSettings?.continuousSend)setReplyPresentation({sequence,conversationId:id,known:new Map(messages.filter(m=>m.role==='assistant').map(m=>[m.id,m]))});
    const previous = pending.current;
    setSavingMessage(!retry && !target && !!conversation.chatSettings?.continuousSend);
    setBusy(true);
    setError("");
    setFeedback("");
    const controller = new AbortController();
    pending.current = controller;
    const draft = text;
    const images=!retry&&!target?imageDraft.ids:[];
    let stored = retry || !!target;
    if (!retry && !target) setText("");
    try {
      if (force) {
        await stopGenerationTask(id);
        previous?.abort();
        await db.transaction("rw", db.conversations, async () => {
          const current=await db.conversations.get(id);
          if(!current||current.activeTimelineId!==expectedPath.timelineId||(current.timelineEpoch??0)!==expectedPath.epoch)throw Error("剧情已在其他窗口切换，请确认后重试。");
          cancelGeneration(id);await invalidateGeneration(id);
        });
      }
      if (!retry && !target && conversation.chatSettings?.continuousSend) {
        recordKeyboardDebug('message-save-start',{flow,inputFocused:document.activeElement===inputRef.current});
        await queueUserMessage(id, draft, expectedPath,images,replyTo??undefined);
        recordKeyboardDebug('message-save-end',{flow,success:true,inputFocused:document.activeElement===inputRef.current});
        stored = true;
        if(ownsView()){imageDraft.clear();setReplyTo(null);await refresh(id, true);}
      } else {
        recordKeyboardDebug('ai-start',{flow,inputFocused:document.activeElement===inputRef.current,disabled:!!inputRef.current?.disabled});
        const task=startGenerationTask({conversation,expectedPath,text:draft,retry,messageId:target?.id,allowArchive,images,replyTo:!retry&&!target?replyTo??undefined:undefined},()=>{
          stored = true;
          if(ownsView()){
            if(!target)imageDraft.clear();
            if(!retry&&!target)setReplyTo(null);
            void refresh(id,true).catch(()=>{if(ownsView())setError("无法读取聊天记录，请检查本地存储。");});
          }
        });
        pending.current=task.controller;
        await task.done;
        if(conversation.mode==='daily'&&!conversation.worldId){
          void Promise.all([import('./privateNotesGeneration'),import('./automationQueue')]).then(([{generatePrivateNote},{enqueueAutomation}])=>enqueueAutomation('notes:'+conversation.characterId,()=>generatePrivateNote(conversation.characterId))).catch(()=>{/* Private notes must never block chat replies. */});
        }
      }
      if(retry)recordKeyboardDebug('reply-returned',{success:true});
    } catch (e) {
      if(!retry&&!target&&conversation.chatSettings?.continuousSend&&!stored)recordKeyboardDebug('message-save-end',{flow,success:false,inputFocused:document.activeElement===inputRef.current});
      if(retry&&keyboardDebugEnabled())recordKeyboardDebug('reply-returned',{success:false,reason:e instanceof Error&&e.message==='此会话正在回复中，请稍候。'?'service-lock':e instanceof Error&&e.message==='剧情已在其他窗口切换，请确认当前消息后重试。'?'service-path':e instanceof Error&&e.message==='没有可重试的用户消息。'?'service-no-pending':'generation-failed'});
      if (ownsView()) {
        if (!stored && !retry && !target) setText(draft);
        if(getGenerationTask(id)?.status!=='failed')await retainGenerationFailure({id:crypto.randomUUID(),conversationId:id,characterId:conversation.characterId,worldId:conversation.worldId,timelineId:expectedPath.timelineId,epoch:expectedPath.epoch,startedAt:Date.now(),status:'failed',saved:stored},e);

      }
      if (force&&ownsView()) throw e;
    } finally {
      if (ownsView()) {
        await refresh(id, !target).catch(() => {
          if(ownsView())setError("无法读取聊天记录，请检查存储空间。");
        });
        if(ownsView()){
          setBusy(false);
          setSavingMessage(false);
          pending.current = null;
        }
      }
    }
  }
  const send = (retry = false, origin: "automatic"|"manual" = "manual") => {
    const flow=retry?origin:"ordinary";
    if(!retry)recordKeyboardDebug('send-start',{flow,inputFocused:document.activeElement===inputRef.current,idle:!busy,noPending:!pending.current});
    if(retry)recordKeyboardDebug('send-true',{flow,hasConversation:!!conversation,idle:!busy,noPending:!pending.current});
    if(retry)keyboardAutoReply.cancel();
    if (!retry && ((!text.trim()&&!imageDraft.ids.length) || imageDraft.processing || busy || pending.current)) return Promise.resolve();
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
    blocked:attachmentOpen||imageDraft.processing||management||!!menuId||!!previewVariant||showSnapshots||requests||(busy&&!savingMessage),
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
    setSelection(undefined);
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
    appliedSnapshot.current=null;
    pendingQuoteJump.current=null;
    setSelection(undefined);
    setPreviewVariant(undefined);
    clearTimeout(highlightTimer.current);
    setReplyPresentation(null);
    taskSequence.current++;
    activeConversation.current = null;
    visiblePath.current=null;
    // Keep in-flight generation owned by generationTasks when leaving this view.
    pending.current = null;
    setBusy(false);
    setSavingMessage(false);
    setConversation(null);
    setReplyTo(null);
    setMessages([]);
    setText("");
    setError("");
    setFeedback("");
    setManagement(false);
    setMenuId(null);
    setShowSnapshots(false);
  }
  const bubbleScope=useMemo(()=>conversation?{id:conversation.id,mode:conversation.mode,timelineEpoch:conversation.timelineEpoch}:undefined,[conversation?.id,conversation?.mode,conversation?.timelineEpoch]);
  const visibleMessages=useMemo(()=>messages.slice(historyWindow.start,historyWindow.end),[messages,historyWindow.start,historyWindow.end]);
  const messageIndex=useMemo(()=>new Map(messages.map(m=>[m.id,m])),[messages]);
  const timeLabels=useMemo(()=>chatTimeLabels(messages.slice(Math.max(0,historyWindow.start-1),historyWindow.end)),[messages,historyWindow.start,historyWindow.end]);
  useEffect(()=>{if(!conversation){setVariants({});return;}let alive=true;const id=conversation.id,ids=visibleMessages.map(m=>m.id);
   const sub=liveQuery(()=>db.messageVariants.where('messageId').anyOf(ids).filter(v=>v.conversationId===id).toArray()).subscribe({next:rows=>{if(!alive)return;const groups:Record<string,MessageVariant[]>={};for(const v of rows)(groups[v.messageId]??=[]).push(v);for(const list of Object.values(groups))list.sort((a,b)=>a.createdAt-b.createdAt||(a.id<b.id?-1:1));setVariants(old=>dataEqual(old,groups)?old:groups);},error:()=>{if(alive)setError('无法读取回复版本，原消息保留。');}});return()=>{alive=false;sub.unsubscribe();};
  },[conversation?.id,visibleMessages]);
  // Keep expensive message bubble JSX stable while the composer text changes.
  // Include state read by message actions so menus, versions and continuations stay current.
  const renderedMessages=useMemo(()=>{
    if(!conversation||!bubbleScope)return null;
    return visibleMessages.map((m) => (
              <Fragment key={m.id}>
              {timeLabels.has(m.id)&&<div className="chat-time-divider" data-chat-time-for={m.id}><time dateTime={new Date(m.createdAt).toISOString()}>{timeLabels.get(m.id)}</time></div>}
              <ChatMessage
                message={m}
                playbackKey={replyPresentation?.conversationId===conversation.id && m.role==='assistant' && (replyPresentation.known.get(m.id)?.content!==m.content || replyPresentation.known.get(m.id)?.activeVariantId!==m.activeVariantId) ? `${replyPresentation.sequence}:${m.id}:${m.activeVariantId??''}` : undefined}
                onReveal={onBubbleReveal}
                variants={variants[m.id] || noVariants}
                characterName={displayName}
                characterAvatar={avatarSrc}
                userAvatar={userAvatar}
                userName={userIdentity.name}
                conversation={bubbleScope}
                messageIndex={messageIndex}
                onLocate={locateQuote}
                onMenu={(selected) => {
                  followBottom.current=false;scrollRequested.current=false;preserveTop.current=historyRef.current?.scrollTop??null;
                  setSelection(selected);
                  setMenuPath({timelineId:conversation.activeTimelineId,epoch:conversation.timelineEpoch??0});
                  setReplyPresentation(null);
                  setPreviewVariant(undefined);
                  setMenuId(m.id);
                }}
                onVersion={(v) => void chooseVariant(m, v)}
              />
              {(failuresByMessage.get(m.id)||[]).map(f=><ReplyFailureNotice key={f.id} details={f.failure}/>)}
              {m.role==='assistant'&&conversation.mode==='daily' &&validInterruption(m.replyInterruption)&&<p role="status" className="hint">
                {interruptionLabel(m.replyInterruption)}
                {m.id===messages.at(-1)?.id&&!m.userEdited&&!m.bubbleDeletion&&<button type="button" className="text-button" title="会额外调用一次 API，原文保留。" disabled={busy} onClick={()=>{
                  if(busy)return;
                  setError('');
                  try{const task=startGenerationTask({conversation,expectedPath:{timelineId:conversation.activeTimelineId,epoch:conversation.timelineEpoch??0},text:'',retry:false,continuationId:m.id,images:[]});void task.done.catch(()=>{});}catch(e){setError(e instanceof Error?e.message:'续接未发起。');}
                }}>继续生成</button>}
              </p>}
              </Fragment>
            ));
  },[
    messages,messageIndex,visibleMessages,timeLabels,replyPresentation,variants,displayName,avatarSrc,userAvatar,
    userIdentity.name,conversation,bubbleScope,onBubbleReveal,failuresByMessage,busy
  ]);
  if(requests && !worldId && !conversation)return <div className="chat-hub-new-contacts"><button className="message-action" onClick={()=>s.set({activeApp:'角色管理'})}>添加联系人（角色管理）</button><FriendRequests characters={applications} onClose={()=>setRequests(false)}/></div>;
  const listContent=(<>
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
  </>);
  if(!conversation&&!worldId)return <ChatHub characters={characters} applications={applications.length} onOpen={id=>void open(id)} onRequests={()=>setRequests(true)} chats={<>
    <label className="chat-search"><Search size={20} aria-hidden="true"/><input type="search" aria-label="搜索聊天" placeholder="搜索聊天…" value={search} onChange={e=>setSearch(e.target.value)} autoComplete="off"/>{search&&<button type="button" aria-label="清空聊天搜索" onClick={()=>setSearch('')}><X size={18}/></button>}</label>
{applications.length>0&&<button className="friend-requests-entry" onClick={()=>setRequests(true)}>新的好友申请 <span>{applications.length}</span></button>}{listContent}{error&&<p role="alert">{error}</p>}</>}/>;
  return (
    <div className={`chat-app ${conversation ? "chat-immersive" : ""} ${conversation?.chatSettings?.background ? 'chat-custom-background' : ''}`} style={conversation?.chatSettings?.background?.kind==='color'?{background:conversation.chatSettings.background.color}:conversation?.chatSettings?.background?.kind==='image'?{'--chat-background-image':`linear-gradient(var(--theme-chat-image-wash,rgba(243,245,236,.4)),var(--theme-chat-image-wash,rgba(243,245,236,.4))),url("${s.assets.find(a=>a.id===(conversation.chatSettings?.background?.kind==='image'?conversation.chatSettings.background.assetId:undefined))?.data || ''}")`} as CSSProperties:undefined}>
      {!conversation && <h2 className="chat-list-title">聊天</h2>}
      {!conversation && !worldId && <label className="chat-search"><Search size={20} aria-hidden="true"/><input type="search" aria-label="搜索聊天" placeholder="搜索聊天…" value={search} onChange={e=>setSearch(e.target.value)} autoComplete="off"/>{search && <button type="button" aria-label="清空聊天搜索" onClick={()=>setSearch("")}><X size={18}/></button>}</label>}
      {!conversation && !worldId && applications.length>0 && <button className="friend-requests-entry" onClick={()=>setRequests(true)}>新的好友申请 <span>{applications.length}</span></button>}
      {!conversation && worldId && <p className="chat-world-caption">世界聊天 · {world?.name || "世界不存在"}</p>}
      {!conversation ? (
        <>
{listContent}        </>
      ) : (
        <>
          <div className="chat-view" hidden={management}>
          <nav className="chat-nav" aria-label="当前会话导航">
            <button aria-label="返回角色列表" onClick={leaveConversation}>
              <ChevronLeft size={24} />
            </button>
            <div className="chat-nav-heading"><span
              className="chat-nav-title"
              role="heading"
              aria-level={1}
              title={displayName}
            >
              {displayName}
            </span>{busy&&<ReplyPending/>}</div>
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
              historyWindow.onScroll();
              // Older pages are loaded explicitly from the history capsule.
            }}
          >
            {displayHasMore.current&&!displayFullyLoaded.current&&(
              <div className="chat-history-load-more">
                <button type="button" className="chat-history-load-capsule" onClick={()=>void loadOlderDisplayMessages()}>
                  点击查看历史记录
                </button>
              </div>
            )}
            {!messages.length && (
              <p className="hint">这是一个独立会话。说一句话，开始新的交流。</p>
            )}
            <div data-history-spacer="" aria-hidden="true" style={{height:historyWindow.top,padding:0,margin:0,border:0,flexShrink:0,pointerEvents:'none'}}/>
            {renderedMessages}
            <div data-history-spacer="" data-history-bottom="" aria-hidden="true" style={{height:historyWindow.bottom,padding:0,margin:0,border:0,flexShrink:0,pointerEvents:'none'}}/>
            {remotePending&&<p role="status">请求状态待确认：可能仍在其他窗口处理中。可等待，或停止后手动重试；不会自动重复请求。</p>}
            {!busy&&conversation.sendingToken&&!runningTask(generationTask)&&<p role="status">上次请求尚未确认完成，可能已中断；不会自动重发。请确认后手动重试。</p>}
            {visibleFailures.filter(f=>!f.messageId).map(f=><ReplyFailureNotice key={f.id} details={f.failure}/>)}
            {!busy&&!error&&taskMatches&&generationTask?.status==='stopped'&&<p role="status">{generationTask.error}</p>}
            <div ref={bottom} />
          </div>
          <div className="chat-footer">
            {feedback && (
              <p role="status" className="chat-feedback">
                {feedback}
              </p>
            )}
            {error && !busy && (
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
            {replyTo&&<div className="chat-quote-draft" aria-label="引用预览"><span><strong>{replyTo.role==='user'?userIdentity.name:displayName}</strong><small>{quoteSummary(replyTo)}</small></span><button type="button" aria-label="取消引用" onClick={()=>setReplyTo(null)}><X size={18}/></button></div>}
            {imageDraft.ids.length>0&&<div className="chat-pending-images" aria-label="待发送图片">{imageDraft.ids.map(id=><div key={id}><StoredImage id={id}/><button type="button" aria-label="移除待发送图片" disabled={busy||imageDraft.processing} onClick={()=>void imageDraft.remove(id,text)}>×</button></div>)}<small>最多3张；大图缩至1600px，单张≤1.5MB，请使用支持视觉输入的模型。{imageDraft.processing?'处理中…':''}{imageDraft.notice}</small></div>}
            <form
              className="chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {conversation.chatSettings?.continuousSend && <button className="chat-reply-button" type="button" aria-label="AI 回复" title="让 AI 回复待回复消息" disabled={busy || messages.at(-1)?.role!=="user"} onClick={()=>void send(true)}><span aria-hidden="true">AI 回复</span><svg width={24} height={24} viewBox="0 0 24 24" fill="none" data-icon="double-sparkle" aria-hidden="true"><path d="M9.5 6 11.8 11.7 17.5 14 11.8 16.3 9.5 22 7.2 16.3 1.5 14 7.2 11.7Z" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round"/><path d="M19 1l1.2 3.3L23.5 5.5l-3.3 1.2L19 10l-1.2-3.3-3.3-1.2 3.3-1.2Z" fill="currentColor"/></svg></button>}
              <div className="chat-input-wrap">
              <textarea
                ref={inputRef}
                rows={1}
                aria-label="聊天消息"
                placeholder="说点什么…"
                enterKeyHint={conversation.chatSettings?.continuousSend ? "send" : undefined}
                maxLength={8000}
                value={text}
                disabled={busy && !savingMessage}
                onChange={(e) => {setText(e.target.value);if(!busy)imageDraft.caption(e.target.value);}}
                onCompositionStart={()=>enterGuard.current.start()}
                onCompositionEnd={()=>enterGuard.current.end()}
                onKeyUp={e=>enterGuard.current.up(e.key)}
                onBlur={()=>enterGuard.current.reset()}
                onKeyDown={e=>{const action=enterGuard.current.key(e.nativeEvent);if(action==='send'||action==='block')e.preventDefault();if(action==='send')void send();}}
              />
              <AttachmentMenu disabled={busy||!imageDraft.ready} processing={imageDraft.processing} scope={imageDraft.scope} onOpenChange={setAttachmentOpen} onChoose={(files,scope)=>void imageDraft.choose(files,text,scope)} onSyncQq={()=>void manualQqSync()} qqSyncEnabled={!!conversation&&conversation.mode==='daily'&&!conversation.worldId&&!!localStorage.getItem('claudia-qq-stable-sync-id')} qqSyncBusy={qqManualSyncBusy}/>
              </div>
              <button
                className={`primary chat-send ${busy ? "is-cancel" : ""}`}
                type={busy ? "button" : "submit"}
                aria-label={busy ? "取消请求" : "发送"}
                disabled={!busy && ((!text.trim()&&!imageDraft.ids.length)||imageDraft.processing)}
                onPointerDown={e=>{if(conversation.chatSettings?.continuousSend && document.activeElement===inputRef.current)e.preventDefault();}}
                onMouseDown={e=>{if(conversation.chatSettings?.continuousSend && document.activeElement===inputRef.current)e.preventDefault();}}
                onClick={busy ? () => {if(conversation)void stopGenerationTask(conversation.id).catch(()=>setError("停止请求失败，请稍后重试。"));} : undefined}
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
              selection={selection}
              expectedPath={menuPath??{timelineId:conversation.activeTimelineId,epoch:conversation.timelineEpoch??0}}
              onQuote={async(part,base)=>{
                const id=conversation.id,q=await prepareQuote(id,menuId!,part,menuPath??{timelineId:conversation.activeTimelineId,epoch:conversation.timelineEpoch??0},base);
                await refresh(id);
                if(activeConversation.current===id&&visiblePath.current?.timelineId===q.timelineId&&visiblePath.current.epoch===q.epoch)setReplyTo(q);
              }}
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
              onLocate={id=>{void searchableMessages(conversation.id).then(async rows=>{if(activeConversation.current!==conversation.id)return;if(!rows.some(m=>m.id===id)){setError('该消息已不在当前有效分支。');return;}await revealFullHistory(conversation.id);jumpTo.current=id;setManagement(false);}).catch(()=>setError('无法定位消息，请稍后重试。'));}}
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
      {conversation && <ConversationLayoutDebug/>}
    </div>
  );
}

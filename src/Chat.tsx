import { liveQuery } from "dexie";
import { chatListPreviews, chatPreviewTime, type ChatPreview } from "./chatListPreview";
import { ChevronLeft, MoreHorizontal, Send, Square } from "lucide-react";
import { ChatManagement } from "./ChatManagement";
import { chatDisplayName } from "./chatPresentation";
import { useChatViewport } from "./useChatViewport";
import { activeMessages } from "./messagePath";
import {
  cancelGeneration,
  invalidateGeneration,
  selectVariant,
} from "./messageOperations";
import { MessageAvatar, ChatMessage, MessageTools, SnapshotTools } from "./MessageUI";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { db, usePhone } from "./store";
import type { Conversation, Message, MessageVariant } from "./chatTypes";
import type { ApiConfig } from "./api";
import {
  getConversation,
  sendMessage,
  deleteConversation,
  resolveApi,
  regenerateMessage,
} from "./chatService";
export function Chat({ worldId }: { worldId?: string }) {
  const s = usePhone();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [previewState, setPreviews] = useState<{scope: string; rows: Record<string, ChatPreview>}>({scope: "", rows: {}});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
  const activeConversation = useRef<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followBottom = useRef(true);
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
  const displayName = chatDisplayName(character);
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
    : s.characters;
  const characterIds = JSON.stringify(characters.map(c => c.id));
  const previewScope = JSON.stringify([worldId ?? null, characterIds]);
  const previews = previewState.scope === previewScope ? previewState.rows : {};
  useEffect(() => {
    if (conversation) return;
    setPreviews({scope: previewScope, rows: {}});
    const subscription = liveQuery(() => chatListPreviews(characters.map(c => c.id), worldId))
      .subscribe({ next: rows => setPreviews({scope: previewScope, rows}), error: () => setError("无法读取聊天预览，请稍后重试。") });
    return () => subscription.unsubscribe();
  }, [characterIds, worldId, conversation?.id]);
  async function refresh(id: string, scroll = false) {
    const rows = await activeMessages(id);
    const ids = new Set(rows.map((m) => m.id));
    const all = await db.messageVariants
      .where("conversationId")
      .equals(id)
      .filter((v) => ids.has(v.messageId))
      .toArray();
    const groups: Record<string, MessageVariant[]> = {};
    for (const v of all) (groups[v.messageId] ??= []).push(v);
    for (const list of Object.values(groups))
      list.sort(
        (a, b) =>
          a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    if (mounted.current && activeConversation.current === id) {
      if (scroll && followBottom.current) {
        scrollRequested.current = true;
        preserveTop.current = null;
      } else preserveTop.current = historyRef.current?.scrollTop ?? null;
      setMessages(rows);
      setVariants(groups);
    }
  }
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
    try {
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
  ) {
    if (!conversation || (busy && !force)) return;
    const id = conversation.id;
    if (!retry && !target) followBottom.current = true;
    const sequence = ++taskSequence.current;
    const previous = pending.current;
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
        cancelGeneration(id);
        await db.transaction("rw", db.conversations, () =>
          invalidateGeneration(id),
        );
      }
      if (target)
        await regenerateMessage(id, target.id, controller.signal, allowArchive);
      else
        await sendMessage(id, draft, controller.signal, retry, async () => {
          stored = true;
          await refresh(id, true);
        });
    } catch (e) {
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
        pending.current = null;
      }
    }
  }
  const send = (retry = false) => runGeneration(retry);
  const onGenerate = (message?: Message, allowArchive = false) =>
    runGeneration(true, message, allowArchive, true);
  async function chooseVariant(m: Message, v: MessageVariant) {
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
    taskSequence.current++;
    activeConversation.current = null;
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setConversation(null);
    setMessages([]);
    setText("");
    setError("");
    setFeedback("");
    setManagement(false);
    setMenuId(null);
    setShowSnapshots(false);
  }
  return (
    <div className={`chat-app ${conversation ? "chat-immersive" : ""}`}>
      {!conversation && <h2 className="chat-list-title">聊天</h2>}
      {!conversation && (
        <div className="chat-space">
          <strong>
            {worldId
              ? `世界聊天 · ${world?.name || "世界不存在"}`
              : "日常聊天 · 独立空间"}
          </strong>
          <p>
            {worldId
              ? "只使用本世界设定和本会话历史。"
              : "不读取任何世界设定或世界聊天记录。"}
          </p>
        </div>
      )}
      {!conversation ? (
        <>
          {characters.map((c) => (
            <button
              className="chat-list-row"
              aria-label={`${c.name} 开始 / 继续聊天`}
              key={c.id}
              onClick={() => void open(c.id)}
            >
              <MessageAvatar src={s.assets.find(a => a.id === c.avatar)?.data} name={c.name}/>
              <span className="chat-list-info"><strong>{c.name}</strong><span className="chat-list-preview">{previews[c.id]?.content || "开始聊天"}</span></span>
              {previews[c.id] && <time dateTime={new Date(previews[c.id].createdAt).toISOString()}>{chatPreviewTime(previews[c.id].createdAt)}</time>}
            </button>
          ))}
          {!characters.length && (
            <div className="card">
              <p>
                {worldId
                  ? "请先在此世界关联角色。"
                  : "还没有角色。无需创建世界即可创建基础角色并开始日常聊天。"}
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
            <button aria-label="会话管理" onClick={() => setManagement(true)}>
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
              <ChatMessage
                key={m.id}
                message={m}
                variants={variants[m.id] || []}
                characterName={displayName}
                characterAvatar={avatarSrc}
                onMenu={() => {
                  setPreviewVariant(undefined);
                  setMenuId(m.id);
                }}
                onVersion={(v) => void chooseVariant(m, v)}
              />
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
              <textarea
                ref={inputRef}
                rows={1}
                aria-label="聊天消息"
                placeholder="说点什么…"
                maxLength={8000}
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                className={`primary chat-send ${busy ? "is-cancel" : ""}`}
                type={busy ? "button" : "submit"}
                aria-label={busy ? "取消请求" : "发送"}
                disabled={!busy && !text.trim()}
                onClick={busy ? () => pending.current?.abort() : undefined}
              >
                {busy ? <Square size={18} /> : <Send size={20} />}
              </button>
            </form>
            {!busy && messages.at(-1)?.role === "user" && (
              <button
                className="text-button chat-retry"
                onClick={() => void send(true)}
              >
                重试最后一条消息
              </button>
            )}
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
    </div>
  );
}

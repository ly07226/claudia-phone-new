import { activeMessages } from "./messagePath";
import {
  cancelGeneration,
  invalidateGeneration,
  selectVariant,
} from "./messageOperations";
import { ChatMessage, MessageTools, SnapshotTools } from "./MessageUI";
import { useEffect, useRef, useState } from "react";
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
  const [feedback, setFeedback] = useState("");
  const taskSequence = useRef(0);
  const scrollRequested = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const world = worldId ? s.worlds.find((w) => w.id === worldId) : undefined;
  const characters = worldId
    ? s.characters.filter((c) =>
        s.worldProfiles.some(
          (p) => p.worldId === worldId && p.characterId === c.id,
        ),
      )
    : s.characters;
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
    if (mounted.current) {
      if (scroll) scrollRequested.current = true;
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
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    const phone = document.querySelector<HTMLElement>(".phone");
    const viewport = window.visualViewport;
    const update = () =>
      phone?.style.setProperty(
        "--chat-height",
        `${viewport?.height || window.innerHeight}px`,
      );
    if (phone) {
      phone.scrollTop = 0;
      phone.scrollLeft = 0;
    }
    phone?.classList.add("chat-open");
    update();
    viewport?.addEventListener("resize", update);
    return () => {
      phone?.classList.remove("chat-open");
      phone?.style.removeProperty("--chat-height");
      viewport?.removeEventListener("resize", update);
    };
  }, []);
  useEffect(() => {
    if (scrollRequested.current) {
      bottom.current?.scrollIntoView({ block: "end", behavior: "auto" });
      scrollRequested.current = false;
    }
  }, [messages, busy]);
  async function open(id: string) {
    setError("");
    setMessages([]);
    try {
      const c = await getConversation(id, worldId);
      setConversation(c);
      await refresh(c.id, true);
      try {
        await resolveApi(c);
      } catch (e) {
        setError(e instanceof Error ? e.message : "无法读取 API。");
      }
    } catch {
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
  return (
    <div className="chat-app">
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
      {!conversation ? (
        <>
          <h2>选择角色</h2>
          {characters.map((c) => (
            <button
              className="list-row"
              key={c.id}
              onClick={() => void open(c.id)}
            >
              {c.name}
              <span>开始 / 继续聊天</span>
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
          <div className="chat-heading">
            <button
              disabled={busy}
              onClick={() => {
                setConversation(null);
                setMessages([]);
                setText("");
                setError("");
              }}
            >
              返回角色列表
            </button>
            <strong>
              {
                s.characters.find((c) => c.id === conversation.characterId)
                  ?.name
              }
            </strong>
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    "仅删除当前会话及其全部消息？角色、世界与其他聊天空间不受影响。",
                  )
                )
                  return;
                try {
                  await deleteConversation(conversation.id);
                  setConversation(null);
                  setMessages([]);
                } catch {
                  setError("删除失败，请检查本地存储。");
                }
              }}
            >
              删除会话
            </button>
          </div>
          <button
            className="text-button message-snapshots-button"
            onClick={() => setShowSnapshots(true)}
          >
            历史快照 / 分支恢复
          </button>
          {feedback && (
            <p role="status" className="hint">
              {feedback}
            </p>
          )}
          <label className="world-select">
            本会话 API
            <select
              aria-label="本会话 API"
              disabled={busy}
              value={conversation.apiConfigId || ""}
              onChange={async (e) => {
                try {
                  const next = {
                    ...conversation,
                    apiConfigId: e.target.value || undefined,
                  };
                  await db.conversations.update(conversation.id, {
                    apiConfigId: next.apiConfigId,
                  });
                  setConversation(next);
                  setError("");
                  try {
                    await resolveApi(next);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "API 不可用。",
                    );
                  }
                } catch {
                  setError("会话设置保存失败。");
                }
              }}
            >
              <option value="">跟随角色 / 全局默认</option>
              {conversation.apiConfigId &&
                !configs.some((c) => c.id === conversation.apiConfigId) && (
                  <option value={conversation.apiConfigId}>
                    已删除的配置（请选择其他）
                  </option>
                )}
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.enabled ? "（已停用）" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="chat-history" aria-label="当前会话消息">
            {!messages.length && (
              <p className="hint">这是一个独立会话。说一句话，开始新的交流。</p>
            )}
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                message={m}
                variants={variants[m.id] || []}
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
          {error && (
            <div className="chat-error" role="alert">
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
              aria-label="聊天消息"
              placeholder="说点什么…"
              maxLength={8000}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="primary"
              type="submit"
              disabled={busy || !text.trim()}
            >
              发送
            </button>
          </form>
          {busy ? (
            <button
              className="text-button"
              onClick={() => pending.current?.abort()}
            >
              取消请求
            </button>
          ) : (
            messages.at(-1)?.role === "user" && (
              <button className="text-button" onClick={() => void send(true)}>
                重试最后一条消息
              </button>
            )
          )}
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
          <p className="hint">
            本地保存完整记录；发送最近最多 30 条 / 24000 字符。可能产生 API
            费用。
          </p>
        </>
      )}
      {error && !conversation && <p role="alert">{error}</p>}
    </div>
  );
}

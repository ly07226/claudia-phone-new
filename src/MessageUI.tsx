import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, UserRound } from "lucide-react";
import type {
  Message,
  MessageVariant,
  ConversationSnapshot,
  MessageRevision,
} from "./chatTypes";
import { splitAssistantBubbles } from "./splitAssistantBubbles";
import { useMessagePress } from "./useMessagePress";
import { db } from "./store";
import {
  editMessage,
  removeMessage,
  restoreSnapshot,
  restoreRevision,
  selectVariant,
} from "./messageOperations";
export function MessageAvatar({
  src,
  name,
  user = false,
}: {
  src?: string;
  name: string;
  user?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span
      className={`chat-avatar ${user ? "chat-avatar-user" : "chat-avatar-character"}`}
      role="img"
      aria-label={`${name}头像`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : user ? (
        <UserRound size={19} />
      ) : (
        <span>{name.slice(0, 1) || "角"}</span>
      )}
    </span>
  );
}
/** Boundary newlines separate display bubbles; retain their text without line boxes. */
function AssistantBubbleText({ content }: { content: string }) {
  const leading = content.match(/^(?:[^\S\r\n]*[\r\n])+/)?.[0] || "";
  const rest = content.slice(leading.length);
  const trailing = rest.match(/(?:[\r\n][^\S\r\n]*)+$/)?.[0] || "";
  return (
    <>
      {leading && (
        <span className="chat-bubble-boundary-space" aria-hidden="true">
          {leading}
        </span>
      )}
      {rest.slice(0, rest.length - trailing.length)}
      {trailing && (
        <span className="chat-bubble-boundary-space" aria-hidden="true">
          {trailing}
        </span>
      )}
    </>
  );
}
export function ChatMessage({
  message: m,
  variants,
  onMenu,
  onVersion,
  characterName = "角色",
  characterAvatar,
}: {
  message: Message;
  variants: MessageVariant[];
  onMenu: () => void;
  onVersion: (variant: MessageVariant) => void;
  characterName?: string;
  characterAvatar?: string;
}) {
  const handlers = useMessagePress(onMenu);
  const fragments = useMemo(
    () =>
      m.role === "assistant" ? splitAssistantBubbles(m.content) : [m.content],
    [m.role, m.content],
  );
  const index = Math.max(
    0,
    variants.findIndex((v) => v.id === m.activeVariantId),
  );
  return (
    <div className={`chat-message-row chat-message-row-${m.role}`}>
      {m.role !== "user" && (
        <MessageAvatar src={characterAvatar} name={characterName} />
      )}
      <div className="chat-message-stack">
        <div
          className={`chat-bubble chat-${m.role}`}
          data-message-id={m.id}
          {...handlers}
        >
          <button
            type="button"
            className="message-access"
            aria-label={m.role === "user" ? "用户消息操作" : "AI 消息操作"}
            aria-haspopup="dialog"
            aria-description={
              m.userEdited
                ? "用户已编辑。打开完整消息的操作菜单。"
                : "打开完整消息的操作菜单。"
            }
            onClick={onMenu}
          >
            消息操作
          </button>
          {fragments.map((fragment, fragmentIndex) => (
            <div className="chat-bubble-surface" key={fragmentIndex}>
              <p>
                {m.role === "assistant" ? (
                  <AssistantBubbleText content={fragment} />
                ) : (
                  fragment
                )}
              </p>
            </div>
          ))}
          {m.role === "assistant" && variants.length > 1 && (
            <div className="message-versions" aria-label="回复版本">
              <button
                aria-label="上一个回复版本"
                disabled={index === 0}
                onClick={() => onVersion(variants[index - 1])}
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {index + 1} / {variants.length || 1}
              </span>
              <button
                aria-label="下一个回复版本"
                disabled={index >= variants.length - 1}
                onClick={() => onVersion(variants[index + 1])}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          )}
        </div>
      </div>
      {m.role === "user" && <MessageAvatar name="你" user />}
    </div>
  );
}
export function MessageSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const backdropDown = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const viewport = window.visualViewport;
    const resize = () => {
      root.current?.style.setProperty(
        "--sheet-height",
        `${viewport?.height || innerHeight}px`,
      );
      root.current?.style.setProperty(
        "--sheet-top",
        `${viewport?.offsetTop || 0}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    root.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const nodes = [
          ...root.current!.querySelectorAll<HTMLElement>(
            'button:not([disabled]),textarea,input,select,[tabindex="0"]',
          ),
        ];
        const first = nodes[0],
          last = nodes.at(-1);
        if (!root.current?.contains(document.activeElement)) {
          e.preventDefault();
          first?.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      previous?.isConnected && previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      ref={root}
      className="message-backdrop"
      onPointerDown={(e) => {
        backdropDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (backdropDown.current && e.target === e.currentTarget) onClose();
        backdropDown.current = false;
      }}
    >
      <section
        className="message-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h3>{title}</h3>
          <button aria-label="关闭消息面板" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="message-sheet-scroll">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
function confirmTail(hasLater: boolean) {
  return (
    !hasLater ||
    confirm(
      "修改历史消息可能影响后续剧情。将保存当前路径快照，并从当前有效聊天中移除后续消息。是否继续？",
    )
  );
}
export function MessageTools({
  message,
  conversationId,
  messages,
  onClose,
  onRefresh,
  onError,
  onGenerate,
  onDraft,
  preview,
}: {
  message: Message | null;
  conversationId: string;
  messages: Message[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onError: (text: string) => void;
  onGenerate: (message?: Message, allowArchive?: boolean) => Promise<void>;
  onDraft: (text: string) => void;
  preview?: MessageVariant;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(message?.content || "");
  const editBase = useRef({
    content: message?.content || "",
    activeVariantId: message?.activeVariantId,
  });
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [revisions, setRevisions] = useState<MessageRevision[]>([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  useEffect(() => {
    if (message)
      void db.messageRevisions
        .where("messageId")
        .equals(message.id)
        .filter(
          (r) =>
            r.conversationId === conversationId &&
            (!r.variantId || r.variantId === message.activeVariantId),
        )
        .toArray()
        .then((rows) =>
          setRevisions(rows.sort((a, b) => b.createdAt - a.createdAt)),
        )
        .catch(() => setFeedback("无法读取修订历史。"));
  }, [message?.id, message?.activeVariantId, conversationId]);
  if (!message) return null;
  const m = message;
  const hasLater =
    messages.findIndex((x) => x.id === m.id) < messages.length - 1;
  const latestUser =
    messages.filter((x) => x.role === "user").at(-1)?.id === m.id;
  async function act(fn: () => Promise<void>) {
    if (working) return;
    setWorking(true);
    setFeedback("");
    try {
      await fn();
      await onRefresh();
      onClose();
      return true;
    } catch (e) {
      setFeedback(
        e instanceof Error ? e.message : "操作失败，请检查本地存储。",
      );
      return false;
    } finally {
      setWorking(false);
    }
  }
  async function save(regenerate = false) {
    if (!content.trim()) {
      setFeedback("消息不能为空。");
      return;
    }
    if (!confirmTail(hasLater)) return;
    const ok = await act(() =>
      editMessage(conversationId, m.id, content, hasLater, editBase.current),
    );
    if (ok && regenerate)
      await onGenerate().catch((e) =>
        onError(
          e instanceof Error ? e.message : "修改已保存，但重新回复失败。",
        ),
      );
  }

  async function copy() {
    const text = preview?.content || m.content;
    try {
      if (!navigator.clipboard?.writeText) throw Error();
      await navigator.clipboard.writeText(text);
      setFeedback("已复制消息文本。");
    } catch {
      setCopyFallback(true);
      setFeedback("浏览器未允许自动复制，可在下方文本框选择文本复制。");
    }
  }
  return (
    <MessageSheet
      title={
        preview
          ? "历史回复版本预览（尚未应用）"
          : editing
            ? "编辑消息"
            : "消息操作"
      }
      onClose={() => {
        if (!working) onClose();
      }}
    >
      {feedback && (
        <p role="status" className="hint">
          {feedback}
        </p>
      )}
      {preview ? (
        <>
          <p className="message-preview">{preview.content}</p>
          <p className="hint">
            预览不改变正式版本，也不会进入 Prompt。应用后，后续剧情会先归档。
          </p>
          <button
            className="primary"
            disabled={working}
            onClick={() => {
              if (confirmTail(hasLater))
                void act(() =>
                  selectVariant(conversationId, m.id, preview.id, hasLater),
                );
            }}
          >
            使用此版本
          </button>
          <button className="message-action" onClick={() => void copy()}>
            复制预览文本
          </button>
        </>
      ) : editing ? (
        <>
          <textarea
            aria-label="编辑消息内容"
            className="message-editor"
            value={content}
            maxLength={m.role === "user" ? 8000 : 100000}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="message-edit-actions">
            <button disabled={working} onClick={onClose}>
              取消
            </button>
            <button
              className="primary"
              disabled={working || !content.trim()}
              onClick={() => void save()}
            >
              仅保存修改
            </button>
            {m.role === "user" && latestUser && (
              <button
                className="primary"
                disabled={working || !content.trim()}
                onClick={() => void save(true)}
              >
                保存并重新回复
              </button>
            )}
          </div>
          <p className="hint">
            修改有后续消息的内容时会先保存可恢复快照；AI
            编辑只改变当前版本并保留修订原文。
          </p>
        </>
      ) : (
        <>
          {m.role === "assistant" && (
            <button
              className="message-action"
              disabled={working}
              onClick={() => {
                if (confirmTail(hasLater)) {
                  onClose();
                  void onGenerate(m, hasLater).catch((e) =>
                    onError(e instanceof Error ? e.message : "重新生成失败。"),
                  );
                }
              }}
            >
              重新生成
            </button>
          )}
          <button
            className="message-action"
            onClick={() => {
              editBase.current = {
                content: m.content,
                activeVariantId: m.activeVariantId,
              };
              setContent(m.content);
              setEditing(true);
            }}
          >
            编辑
          </button>
          {m.role === "user" && (
            <button
              className="message-action"
              disabled={!latestUser || working}
              onClick={() => {
                if (
                  !confirm(
                    "撤回最新用户消息及其后续 AI 回复？将保留可恢复快照，并取消当前生成。",
                  )
                )
                  return;
                const draft = confirm("是否将原文字放回输入框？");
                void act(async () => {
                  const text = await removeMessage(
                    conversationId,
                    m.id,
                    "withdraw",
                    true,
                  );
                  if (draft) onDraft(text);
                });
              }}
            >
              撤回{!latestUser ? "（仅最新用户消息）" : ""}
            </button>
          )}
          <button className="message-action" onClick={() => void copy()}>
            复制
          </button>
          <button
            className="message-action danger"
            disabled={working}
            onClick={() => {
              if (
                confirm(
                  hasLater
                    ? "删除此消息及当前路径中的后续消息？后续剧情可能受影响，整条原路径将保留为可恢复快照。"
                    : "删除此消息？AI 多版本将整组移出当前路径，原内容保留在快照中。",
                )
              )
                void act(() =>
                  removeMessage(conversationId, m.id, "delete", hasLater).then(
                    () => {},
                  ),
                );
            }}
          >
            删除
          </button>
          {revisions.length > 0 && (
            <button
              className="message-action"
              onClick={() => setShowRevisions(!showRevisions)}
            >
              修订历史（{revisions.length}）
            </button>
          )}
          {showRevisions &&
            revisions.map((r) => (
              <div className="card" key={r.id}>
                <p className="message-preview">{r.content}</p>
                <button
                  disabled={working}
                  onClick={() => {
                    if (
                      confirmTail(hasLater) &&
                      confirm("恢复此修订？当前文字也会保存为修订。")
                    )
                      void act(() =>
                        restoreRevision(conversationId, r.id, hasLater),
                      );
                  }}
                >
                  恢复修订
                </button>
              </div>
            ))}
        </>
      )}
      {copyFallback && (
        <textarea
          aria-label="可手动复制的消息文本"
          readOnly
          value={preview?.content || m.content}
          onFocus={(e) => e.target.select()}
        />
      )}
    </MessageSheet>
  );
}
export function SnapshotTools({
  conversationId,
  onClose,
  onRefresh,
}: {
  conversationId: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [rows, setRows] = useState<ConversationSnapshot[]>([]);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(30);
  const [view, setView] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const reason = {
    edit: "编辑前",
    switch: "历史版本切换前",
    withdraw: "撤回前",
    delete: "删除前",
    regenerate: "历史重新生成前",
    restore: "恢复分支前",
  };
  useEffect(() => {
    void db.conversationSnapshots
      .where("conversationId")
      .equals(conversationId)
      .toArray()
      .then((rows) => setRows(rows.sort((a, b) => b.createdAt - a.createdAt)))
      .catch(() => setError("无法读取快照。"));
  }, [conversationId]);
  return (
    <MessageSheet
      title="可恢复的历史快照"
      onClose={() => {
        if (!working) onClose();
      }}
    >
      {error && <p role="alert">{error}</p>}
      <p className="hint">
        快照不会参与当前聊天或世界书扫描。恢复前会先归档当前路径，不会合并剧情。
      </p>
      {!rows.length && <p>暂无历史快照。</p>}
      {rows.slice(0, limit).map((s) => (
        <div className="card" key={s.id}>
          <h4>
            {reason[s.reason]} · {s.messages.length} 条消息
          </h4>
          <small>{new Date(s.createdAt).toLocaleString("zh-CN")}</small>
          <div className="api-actions">
            <button onClick={() => setView(view === s.id ? null : s.id)}>
              查看快照
            </button>
            <button
              disabled={working}
              onClick={async () => {
                if (!confirm("恢复此快照？当前有效路径会先保存为新的快照。"))
                  return;
                setWorking(true);
                try {
                  await restoreSnapshot(conversationId, s.id);
                  await onRefresh();
                  onClose();
                } catch {
                  setError("恢复失败，当前数据未被部分覆盖。");
                } finally {
                  setWorking(false);
                }
              }}
            >
              恢复此快照
            </button>
          </div>
          {view === s.id && (
            <div className="snapshot-preview">
              <p className="hint">仅预览最近 30 条，恢复操作将恢复完整快照。</p>
              {s.messages.slice(-30).map((m) => (
                <p key={m.id}>
                  <strong>{m.role === "user" ? "你" : "角色"}：</strong>
                  {m.content}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
      {rows.length > limit && (
        <button onClick={() => setLimit((n) => n + 30)}>更多快照</button>
      )}
    </MessageSheet>
  );
}

import { useEffect, useRef, useState } from "react";
import { MessageSheet } from "./MessageUI";
import { resolveApi } from "./chatService";
import { testConnection, type ApiConfig, type TestResult } from "./api";
import type { Conversation } from "./chatTypes";
export function ChatManagement({
  conversation,
  name,
  worldName,
  configs,
  busy,
  onApi,
  onSnapshots,
  onDelete,
  onSettings,
  onClose,
}: {
  conversation: Conversation;
  name: string;
  worldName?: string;
  configs: ApiConfig[];
  busy: boolean;
  onApi: (id: string) => Promise<void>;
  onSnapshots: () => void;
  onDelete: () => Promise<void>;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [section, setSection] = useState<"menu" | "info" | "api">("menu");
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
    <MessageSheet title="会话管理" onClose={onClose}>
      {section !== "menu" && (
        <button className="text-button" onClick={() => setSection("menu")}>
          返回管理菜单
        </button>
      )}
      {section === "info" ? (
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
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </MessageSheet>
  );
}

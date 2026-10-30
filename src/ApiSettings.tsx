import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Plus } from "lucide-react";
import { db, usePhone } from "./store";
import {
  providers,
  testConnection,
  validateConfig,
  type ApiConfig,
  type TestResult,
} from "./api";

const labels: Record<TestResult["status"], string> = {
  testing: "测试中",
  success: "连接成功",
  validation: "请检查配置",
  authentication: "认证失败",
  network: "网络错误",
  "base-url": "Base URL 错误",
  model: "模型不存在/不可用",
  unsupported: "Provider 不支持当前测试方式",
  other: "其他错误",
};
export function ApiSettings() {
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState<ApiConfig | null>(null);
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [error, setError] = useState("");
  const running = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const report = () =>
    setError("本地存储操作失败，请检查浏览器存储空间后重试。");
  const reload = async () => {
    const rows = await db.apiConfigs.toCollection().sortBy("createdAt");
    if (mounted.current) setConfigs(rows);
  };
  useEffect(() => {
    mounted.current = true;
    void reload().catch(report);
    return () => {
      mounted.current = false;
      running.current.forEach((c) => c.abort());
      running.current.clear();
    };
  }, []);
  function fresh() {
    setVisible(false);
    setKey("");
    setError("");
    setForm({
      id: crypto.randomUUID(),
      name: "",
      provider: "openai-compatible",
      baseUrl: "",
      model: "",
      temperature: 0.7,
      maxTokens: 1024,
      enabled: true,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  async function edit(c: ApiConfig) {
    try {
      const credential = await db.apiCredentials.get(c.id);
      setKey(credential?.apiKey || "");
      setVisible(false);
      setError("");
      setForm({ ...c });
    } catch {
      report();
    }
  }
  async function persist(c: ApiConfig, apiKey?: string) {
    await db.transaction("rw", [db.apiConfigs, db.apiCredentials], async () => {
      if (c.isDefault && c.enabled)
        await db.apiConfigs.toCollection().modify({ isDefault: false });
      await db.apiConfigs.put({
        ...c,
        isDefault: c.enabled && c.isDefault,
        updatedAt: Date.now(),
      });
      if (apiKey !== undefined)
        await db.apiCredentials.put({ configId: c.id, apiKey });
    });
    setResults((old) => {
      const next = { ...old };
      delete next[c.id];
      return next;
    });
    await reload();
  }
  async function run(c: ApiConfig) {
    if (running.current.has(c.id)) return;
    const controller = new AbortController();
    running.current.set(c.id, controller);
    setResults((old) => ({
      ...old,
      [c.id]: { status: "testing", message: "正在发起最小请求…" },
    }));
    try {
      const credential = await db.apiCredentials.get(c.id);
      const result = await testConnection(
        c,
        credential?.apiKey || "",
        controller.signal,
      );
      if (mounted.current) setResults((old) => ({ ...old, [c.id]: result }));
    } catch {
      if (mounted.current)
        setResults((old) => ({
          ...old,
          [c.id]: {
            status: "other",
            message: "无法读取本地凭据，请检查浏览器存储。",
          },
        }));
    } finally {
      running.current.delete(c.id);
    }
  }
  return (
    <div className="api-settings">
      <div className="page-title">
        <span className="eyebrow">AI CONNECTIONS · 2.1</span>
        <h2>AI / API 设置</h2>
        <p>管理多个连接，为未来的角色聊天做准备。</p>
      </div>
      <div className="card">
        <h3>仅保存在此浏览器</h3>
        <p>
          API Key
          是客户端本地凭据，并非服务器秘密。同源脚本、浏览器扩展或能访问设备的人可能读取它；请使用限额、可撤销的专用
          Key。测试会将 Key 发送到你填写的 HTTPS 服务，请只使用信任的地址。
        </p>
        <p>测试可能产生少量费用。不绕过 CORS，正式聊天尚未开放。</p>
      </div>
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={saving} onClick={fresh}>
        <Plus size={17} />
        新建 API 配置
      </button>
      {configs.length > 0 && (
        <label className="world-select api-switch">
          切换配置
          <select
            aria-label="切换 API 配置"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">全部配置</option>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isDefault ? " · 默认" : ""}
                {!c.enabled ? " · 已停用" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {form && (
        <form
          className="card form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const message = validateConfig(form, key);
            if (message) {
              setError(message);
              return;
            }
            setSaving(true);
            try {
              await persist(
                {
                  ...form,
                  name: form.name.trim(),
                  baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
                  model: form.model.trim(),
                },
                key.trim(),
              );
              setSelected(form.id);
              setForm(null);
              setKey("");
              setVisible(false);
            } catch {
              report();
            } finally {
              setSaving(false);
            }
          }}
        >
          <h3>
            {configs.some((c) => c.id === form.id)
              ? "编辑 API 配置"
              : "新建 API 配置"}
          </h3>
          <label>
            配置名称
            <input
              aria-label="配置名称"
              maxLength={80}
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Provider
            <select
              aria-label="Provider"
              value={form.provider}
              onChange={(e) => {
                const provider = e.target.value;
                setForm({
                  ...form,
                  provider,
                  baseUrl: providers[provider].defaultUrl,
                  protocol: undefined,
                });
              }}
            >
              {Object.entries(providers).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {form.provider === "custom" && (
            <label>
              请求协议
              <select
                aria-label="请求协议"
                value={form.protocol || "unsupported"}
                onChange={(e) =>
                  setForm({
                    ...form,
                    protocol: e.target.value as ApiConfig["protocol"],
                  })
                }
              >
                <option value="unsupported">尚未支持 / 等待代理</option>
                <option value="openai-chat">OpenAI Chat Completions</option>
                <option value="gemini">Gemini generateContent</option>
              </select>
            </label>
          )}
          <label>
            Base URL
            <input
              aria-label="Base URL"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={form.baseUrl}
              placeholder="https://example.com/v1"
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </label>
          <p className="hint">
            填写 API 根地址，包含需要的版本路径；不要填写 /chat/completions
            或模型操作路径，也不要在地址中放 Key。
          </p>
          <label>
            API Key
            <span className="api-key-field">
              <input
                aria-label="API Key"
                type={visible ? "text" : "password"}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button
                type="button"
                aria-label={visible ? "隐藏 API Key" : "显示 API Key"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </span>
          </label>
          <label>
            Model
            <input
              aria-label="Model"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={200}
              required
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </label>
          <label>
            Temperature
            <input
              aria-label="Temperature"
              type="number"
              inputMode="decimal"
              min="0"
              max="2"
              step="0.1"
              value={Number.isNaN(form.temperature) ? "" : form.temperature}
              onChange={(e) =>
                setForm({ ...form, temperature: e.target.valueAsNumber })
              }
            />
          </label>
          <label>
            Max Tokens
            <input
              aria-label="Max Tokens"
              type="number"
              inputMode="numeric"
              min="1"
              max="1000000"
              step="1"
              value={Number.isNaN(form.maxTokens) ? "" : form.maxTokens}
              onChange={(e) =>
                setForm({ ...form, maxTokens: e.target.valueAsNumber })
              }
            />
          </label>
          <label className="api-check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) =>
                setForm({
                  ...form,
                  enabled: e.target.checked,
                  isDefault: e.target.checked && form.isDefault,
                })
              }
            />
            启用配置
          </label>
          <label className="api-check">
            <input
              type="checkbox"
              checked={form.isDefault}
              disabled={!form.enabled}
              onChange={(e) =>
                setForm({ ...form, isDefault: e.target.checked })
              }
            />
            设为默认配置
          </label>
          <p className="hint">
            Temperature 与 Max Tokens
            为未来聊天参数。当前测试固定极短输出，不保证所有模型支持；模型列表自动获取接口已预留。
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setForm(null);
                setKey("");
                setVisible(false);
              }}
            >
              取消
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? "保存中…" : "保存 API 配置"}
            </button>
          </div>
        </form>
      )}
      {!configs.length && !form && (
        <p className="empty">尚无 API 配置。点击上方按钮创建第一个连接。</p>
      )}
      {configs
        .filter((c) => !selected || c.id === selected)
        .map((c) => (
          <div className="card" key={c.id}>
            <h3>{c.name}</h3>
            <p>
              {providers[c.provider]?.label || c.provider} ·{" "}
              {c.isDefault ? "默认 · " : ""}
              {c.enabled ? "已启用" : "已停用"}
            </p>
            <p>{c.model}</p>
            <p className="api-url">{c.baseUrl}</p>
            <p className="hint">
              凭据已隐藏 · Temperature {c.temperature} · Max Tokens{" "}
              {c.maxTokens}
            </p>
            <div className="api-actions">
              <button
                disabled={saving || results[c.id]?.status === "testing"}
                onClick={() => void edit(c)}
              >
                编辑配置
              </button>
              <button
                disabled={saving || results[c.id]?.status === "testing"}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await persist({
                      ...c,
                      enabled: !c.enabled,
                      isDefault: false,
                    });
                  } catch {
                    report();
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {c.enabled ? "停用配置" : "启用配置"}
              </button>
              <button
                disabled={
                  saving ||
                  !c.enabled ||
                  c.isDefault ||
                  results[c.id]?.status === "testing"
                }
                onClick={async () => {
                  setSaving(true);
                  try {
                    await persist({ ...c, isDefault: true });
                  } catch {
                    report();
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                设为默认
              </button>
              <button
                className="danger"
                disabled={saving || results[c.id]?.status === "testing"}
                onClick={async () => {
                  if (
                    !confirm(
                      `删除配置「${c.name}」及其本地 Key？引用它的角色将恢复使用默认 API。`,
                    )
                  )
                    return;
                  setSaving(true);
                  try {
                    await db.transaction(
                      "rw",
                      [db.apiConfigs, db.apiCredentials, db.characters],
                      async () => {
                        await db.apiConfigs.delete(c.id);
                        await db.apiCredentials.delete(c.id);
                        await db.characters
                          .filter((ch) => ch.apiConfigId === c.id)
                          .modify((ch) => {
                            delete ch.apiConfigId;
                          });
                      },
                    );
                    if (form?.id === c.id) {
                      setForm(null);
                      setKey("");
                    }
                    setSelected("");
                    await reload();
                    await usePhone.getState().reload();
                  } catch {
                    report();
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                删除配置
              </button>
            </div>
            <button
              className="primary api-test"
              disabled={
                results[c.id]?.status === "testing" ||
                !c.enabled ||
                saving ||
                form?.id === c.id
              }
              onClick={() => void run(c)}
            >
              {results[c.id]?.status === "testing" ? "测试中…" : "测试连接"}
            </button>
            {results[c.id] && (
              <div
                className={`api-result ${results[c.id].status === "success" ? "api-success" : ""}`}
                role="status"
              >
                <strong>{labels[results[c.id].status]}</strong>
                <p>{results[c.id].message}</p>
              </div>
            )}
          </div>
        ))}
      <p className="hint">
        未来角色可指定配置
        ID；未指定时使用已启用的默认配置。停用的指定配置不会被静默调用，需先调整选择。
      </p>
    </div>
  );
}

import { reconcileApiDefault, selectApiDefault } from "./apiSelection";
import {liveQuery} from 'dexie';
import './apiQuickSelection.css';
import { apiBase, fetchModels } from "./apiModels";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, Eye, EyeOff, Plus } from "lucide-react";
import { AutomationApiPanel } from "./AutomationApiPanel";
import { db, usePhone } from "./store";
import {
  providers,
  testConnection,
  validateConfig,
  type ModelOption,
  type ApiConfig,
  type TestResult,
} from "./api";

const labels: Record<TestResult["status"], string> = {
  timeout: "请求超时",
  cancelled: "请求已取消",
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
  const [notice, setNotice] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const editorSequence = useRef(0);
  const selectionBusy = useRef(false);
  const [form, setForm] = useState<ApiConfig | null>(null);
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [search, setSearch] = useState("");
  const [modelResult, setModelResult] = useState<TestResult | null>(null);
  const [draftResult, setDraftResult] = useState<TestResult | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const modelRequest = useRef<AbortController | null>(null);
  const draftRequest = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const report = () =>
    setError("本地存储操作失败，请检查浏览器存储空间后重试。");
  const reload = async () => {
    const selection = await reconcileApiDefault();
    const rows = await db.apiConfigs.toCollection().sortBy("createdAt");
    if (mounted.current) {
      setConfigs(rows);
      if (selection.changed) setNotice(selection.config ? "已自动选择默认配置。需要回退时按创建时间、ID选择最早的完整启用配置。" : "没有字段完整且启用的配置，请检查或添加 API。");
    }
  };
  useEffect(() => {
    mounted.current = true;
    const subscription=liveQuery(()=>db.apiConfigs.toCollection().sortBy('createdAt')).subscribe({next:rows=>{if(mounted.current)setConfigs(rows);},error:report});
    void reload().catch(report);
    return () => {
      mounted.current = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    modelRequest.current?.abort();
    modelRequest.current = null;
    setModels([]);
    setSearch("");
    setModelResult(null);
    setModelBusy(false);
  }, [form?.id, form?.baseUrl, form?.provider, form?.protocol, key]);
  useEffect(() => {
    draftRequest.current?.abort();
    draftRequest.current = null;
    setDraftResult(null);
    setDraftBusy(false);
  }, [
    form?.id,
    form?.baseUrl,
    form?.provider,
    form?.protocol,
    form?.model,
    form?.temperature,
    form?.maxTokens,
    key,
  ]);
  useEffect(
    () => () => {
      modelRequest.current?.abort();
      draftRequest.current?.abort();
    },
    [],
  );
  useLayoutEffect(() => { panel.current?.scrollIntoView({ block: "start" }); }, [form?.id]);
  function closeEditor() { editorSequence.current++; setForm(null); setKey(""); setVisible(false); }
  async function loadModels() {
    if (!form || modelRequest.current) return;
    const controller = new AbortController();
    modelRequest.current = controller;
    setModelBusy(true);
    setModelResult(null);
    setModels([]);
    try {
      const result = await fetchModels(form, key, controller.signal);
      if (
        mounted.current &&
        !controller.signal.aborted &&
        modelRequest.current === controller
      ) {
        setModels(result.models);
        setModelResult(result.result);
      }
    } finally {
      if (mounted.current && modelRequest.current === controller) {
        modelRequest.current = null;
        setModelBusy(false);
      }
    }
  }
  async function testDraft() {
    if (!form || draftRequest.current) return;
    const controller = new AbortController();
    draftRequest.current = controller;
    setDraftBusy(true);
    setDraftResult(null);
    try {
      const result = await testConnection(
        {
          ...form,
          name: form.name.trim() || "未保存的连接",
          baseUrl: apiBase(form.baseUrl),
          enabled: true,
          isDefault: false,
        },
        key.trim(),
        controller.signal,
      );
      if (
        mounted.current &&
        !controller.signal.aborted &&
        draftRequest.current === controller
      )
        setDraftResult(result);
    } finally {
      if (mounted.current && draftRequest.current === controller) {
        draftRequest.current = null;
        setDraftBusy(false);
      }
    }
  }
  function fresh() {
    editorSequence.current++;
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
    const ticket = ++editorSequence.current;
    try {
      const credential = await db.apiCredentials.get(c.id);
      if (ticket !== editorSequence.current || !mounted.current) return;
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
    await reload();
  }
  async function remove(c: ApiConfig) {
    if (
      !confirm(
        `删除配置「${c.name}」及其本地 Key？引用它的角色将恢复使用默认 API；显式指定它的会话需重新选择。`,
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
      await reload();
      await usePhone.getState().reload();
    } catch {
      report();
    } finally {
      setSaving(false);
    }
  }
  async function selectCurrent(c:ApiConfig){
    if(selectionBusy.current||saving)return;
    selectionBusy.current=true;setSaving(true);setError('');
    try{const rows=await selectApiDefault(c.id);if(mounted.current)setConfigs(rows);}
    catch(e){if(mounted.current)setError(e instanceof Error&&e.message.startsWith('无法切换：')?e.message:'切换失败，请检查配置及浏览器存储后重试；原选择未改变。');}
    finally{selectionBusy.current=false;if(mounted.current)setSaving(false);}
  }
  return (
    <div className="api-settings" ref={panel}>
      <div className="page-title">
        <span className="eyebrow">AI CONNECTIONS</span>
        <h2>AI / API 设置</h2>
        <p>普通聊天与自动任务可使用独立 API。</p>
      </div>
      <AutomationApiPanel configs={configs}/>
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
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
                  baseUrl: apiBase(form.baseUrl),
                  model: form.model.trim(),
                },
                key.trim(),
              );
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
          {notice && <p className="api-default-notice">{notice}</p>}
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
          <div className="api-model-tools">
            <button
              className="primary"
              type="button"
              disabled={modelBusy || saving}
              onClick={() => void loadModels()}
            >
              {modelBusy ? "获取中…" : "获取模型"}
            </button>
            <p className="hint">
              使用当前表单的地址与 Key，无需先保存；也可始终手动填写 Model。
            </p>
            {modelBusy && <p role="status">正在获取模型列表…</p>}
            {modelResult && (
              <div className="api-model-result api-result" role="status">
                <strong>
                  {modelResult.status === "success"
                    ? "模型列表已获取"
                    : labels[modelResult.status]}
                </strong>
                <p>{modelResult.message}</p>
              </div>
            )}
            {models.length > 0 && (
              <>
                <label>
                  搜索模型
                  <input
                    aria-label="搜索模型"
                    type="search"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label>
                  选择模型
                  <select
                    aria-label="选择模型"
                    value={
                      models.some((m) => m.id === form.model) ? form.model : ""
                    }
                    onChange={(e) => {
                      if (e.target.value)
                        setForm({ ...form, model: e.target.value });
                    }}
                  >
                    <option value="">请选择，或在下方手动填写</option>
                    {models
                      .filter((m) =>
                        `${m.id} ${m.name || ""}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .slice(0, 200)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id}
                          {m.name ? ` · ${m.name}` : ""}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="hint">
                  搜索结果最多显示 200
                  项；搜索可缩小范围。列表可见不代表账户一定有调用权限。
                </p>
              </>
            )}
          </div>
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
          <div className="api-draft-tools">
            <button
              className="primary"
              type="button"
              disabled={draftBusy || saving}
              onClick={() => void testDraft()}
            >
              {draftBusy ? "测试当前表单中…" : "测试连接（当前表单）"}
            </button>
            <p className="hint">
              真实发送当前 Model 的极短请求，可能计费；不会保存或覆盖配置。
            </p>
            {draftBusy && <p role="status">测试中：正在请求所选模型…</p>}
            {draftResult && (
              <div className="api-draft-result api-result" role="status">
                <strong>{labels[draftResult.status]}</strong>
                <p>{draftResult.message}</p>
              </div>
            )}
          </div>
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
            为正式聊天参数。当前测试固定极短输出，不保证所有模型支持。获取列表失败时仍可手动填写并测试。
          </p>
          {configs.some(c => c.id === form.id) && <button className="danger api-editor-delete" type="button" disabled={saving} onClick={() => void remove(form)}>删除配置</button>}
          <div className="actions">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                closeEditor();
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
        <p className="empty">尚未配置 API。添加第一个连接后，完整且启用的配置将自动成为默认。</p>
      )}
      {!form && configs.length>0&&<p className="hint api-selection-scope">勾选切换全局默认 API；单独指定 API 的角色或会话仍使用其绑定。</p>}
      {!form && <div role="radiogroup" aria-label="全局默认 API">{configs.map(c => (
        <div className="card api-config-card api-minimal-card api-quick-card" key={c.id} data-api-id={c.id}>
         <button type="button" className="api-config-edit" aria-label={`编辑 ${c.name}`} disabled={saving} onClick={() => void edit(c)}>
          <span className="api-minimal-info"><h3>{c.name}</h3><span className="api-card-model">{c.model}</span></span>
          <ChevronRight size={20} aria-hidden="true"/>
         </button>
         <label className="api-quick-choice">
          <input type="radio" name="current-api" aria-label={`全局默认：${c.name}`} checked={!!c.isDefault} disabled={saving} onChange={()=>void selectCurrent(c)}/>
          <span className="api-choice-circle" aria-hidden="true">{c.isDefault&&<Check size={14}/>}</span>
          {c.isDefault&&<span className="api-choice-caption">使用中</span>}
         </label>
        </div>
      ))}</div>}
      {!form && <button className="primary api-add" aria-label="＋ 添加 API 配置" disabled={saving} onClick={fresh}><Plus size={17}/>添加 API 配置</button>}
      {form && <details className="card api-security">
        <summary>本地凭据与隐私说明</summary>
        <p>
          API Key
          是客户端本地凭据，并非服务器秘密。同源脚本、浏览器扩展或能访问设备的人可能读取它；请使用限额、可撤销的专用
          Key。测试会将 Key 发送到你填写的 HTTPS 服务，请只使用信任的地址。
        </p>
        <p>
          测试和聊天可能产生 API 费用。不绕过
          CORS；请使用支持浏览器直连的可信服务。
        </p>
      </details>}
      {form && <p className="hint">
        角色可指定配置
        ID；未指定时使用已启用的默认配置。停用的指定配置不会被静默调用，需先调整选择。
      </p>}
    </div>
  );
}

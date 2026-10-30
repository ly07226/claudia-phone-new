# API 配置与安全边界 · 2.1

设置 → AI / API 设置：支持多个稳定 UUID 配置、新建、编辑、删除、启停、唯一默认和切换查看。没有实现正式聊天。

## 数据与兼容

Dexie `claudia-phone` 从 v1 增量升级到 v2，仅新增 `apiConfigs`（配置元数据）与 `apiCredentials`（configId、apiKey）两张表，不删除或重写原表。凭据不放入世界、角色、资源或全局 Zustand 状态。

Character 增加可选 apiConfigId，未设置时代表未来使用启用中的默认配置。旧角色兼容，角色编辑保留该字段。删除配置以事务删除凭据并清理角色引用，不删除角色。停用默认配置会清除默认状态，不擅自选择替代配置。

## API Key 安全边界

源码不含真实 Key；不写入日志、GitHub、公开配置或 Vercel 环境变量。输入默认 password，可临时显示，关闭编辑清空表单凭据，列表隐藏 Key。服务端原始响应和异常文本不直接展示，避免服务回显凭据。测试状态仅存页面内存，修改配置后失效。

**IndexedDB 中的 Key 是客户端本地明文凭据，不是服务器级秘密。** 同源 XSS、恶意依赖、扩展、浏览器开发工具或有设备访问权限的人可能读取它。password 只隐藏视觉显示；客户端写死加密密钥也不能解决该边界。建议使用专用、限额、可撤销 Key，不在共享设备保存高权限凭据。清除网站数据会删除本地配置；域名和设备间不自动同步。

测试会将 Key 发送到用户填写的地址，只应填写可信服务。只允许 HTTPS，不允许 URL 账号、查询参数、片段；请求不携带 Cookie、不发送 Referer、不跟随重定向、不绕过 CORS。Key 放在认证请求头，不放 URL。

## 测试连接

校验名称、URL、Key、Model、数值范围和启用状态。发送一次固定 `Hi` 请求，固定输出上限 1 token，不使用未来聊天的 Temperature/Max Tokens。仍可能产生少量费用；部分模型不支持该参数或最小输出限制，会显示错误，不能保证所有兼容服务均可用。

| Provider | 已实现测试协议 |
| --- | --- |
| OpenAI Compatible | POST `{base}/chat/completions`，Bearer，max_tokens: 1 |
| OpenAI | Chat Completions，Bearer，max_completion_tokens: 1 |
| OpenRouter | Chat Completions，Bearer，max_tokens: 1 |
| Google Gemini | POST `{base}/models/{model}:generateContent`，x-goog-api-key，maxOutputTokens: 1 |
| Custom | 明确选择 OpenAI Chat 或 Gemini 协议；未选择时提示不支持，不发送请求 |

Base URL 为包含版本路径的 API 根地址，不包含 chat/completions 等操作路径。成功需 HTTP 成功并返回对应 choices/candidates 数组。401/403 为认证失败；404 按可识别错误码分类模型/URL 错误，存在歧义时提示两者均需检查；429 提示限流或额度。其余错误、格式错误给出可读提示。

20 秒超时，离开页面中止测试。浏览器无法可靠区分 CORS、TLS、网络及重定向错误，UI 明确说明。测试成功只表示本次响应有效，不保证未来额度或参数。

## 后续扩展

ProviderAdapter.listModels 与 ModelOption 预留获取模型列表。ApiTransport / browserTransport 预留后端传输替换点，当前没有 Serverless Function。

建议在 2.2 正式聊天前设计 Vercel Serverless / 后端代理，需身份认证、限流、日志脱敏、禁止凭据缓存、目标地址校验和 SSRF 防护，不能成为任意 URL 转发器。客户端按次传 Key 能解决部分跨域问题，但不会把本地 Key 变成服务器秘密。更强保护需服务端按用户安全存储凭据及密钥管理。

## 验证与部署

自动化覆盖 API CRUD、默认唯一、启停、独立凭据、刷新保存、测试状态、适配器、错误分类、Key 不回显，以及真实 v1 数据库到 v2 的逐表数据比对，并运行全部第一阶段回归用例。网络测试均用合成凭据和模拟响应，未调用真实厂商付费 Key。真实 iPhone Safari 与各 Provider 线上 CORS / 模型兼容性仍待人工验证。

若 Vercel GitHub 集成仍连接本仓库且 Production Branch 为 main，正常推送应自动触发生产部署；以 Dashboard 的 Ready 状态确认。同一生产域名的数据才会保留，预览域名与生产域名 IndexedDB 独立。

本次交付验证：`npm run typecheck` 与 `npm run build` 均通过；全部 6 个 Playwright 综合用例通过（23.9 秒），其中包括原有全部 3 个第一阶段回归用例。测试生成的桌面截图不纳入本次功能提交。

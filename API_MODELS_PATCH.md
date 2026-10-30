# API 设置移动端补丁

仅修改 API 设置及其连通性测试辅助逻辑，没有改动 Daily / World 聊天模块、数据库 schema 或已有记录。保持 IndexedDB v3。

## 使用

设置 → AI / API 设置 → 新建/编辑配置。填写 Base URL 与 Key 即可点“获取模型”，无需先填写名称、Model 或保存。搜索后选择模型会写入 Model，仍可随时手填。失败不改变手填 Model，不更新持久化配置。

Model 下方新增全宽、最小 44px 的“测试连接（当前表单）”，直接使用当前未保存的 Key、URL 和 Model。已保存配置卡片的“测试连接”保留且改为全宽点击区域。成功必须收到实际 Provider 响应，不模拟成功；测试使用极短文本与输出上限 1 token，可能产生费用，部分模型可能拒绝该输出限制。

## Endpoint

| Provider | GET 模型列表 |
| --- | --- |
| OpenAI Compatible | `{base}/models`，Authorization: Bearer |
| OpenAI | 默认 `https://api.openai.com/v1/models`，Authorization: Bearer |
| OpenRouter | 默认 `https://openrouter.ai/api/v1/models`，Authorization: Bearer |
| Custom / OpenAI Chat 协议 | `{base}/models`，Authorization: Bearer |
| Google Gemini | 默认 `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000`，x-goog-api-key |
| Custom / Gemini 协议 | `{base}/models?pageSize=1000`，x-goog-api-key |

Base URL 可更换。获取列表、设置中的测试及保存会去掉末尾斜线、误填的 `/chat/completions` 或 `/models` 操作后缀，避免重复拼接。版本路径如 /v1、/api/v1、/v1beta 保留。聊天模块本身未修改。

Gemini 使用自己的返回格式、nextPageToken 分页和 supportedGenerationMethods 筛选，只提供支持 generateContent 的模型。最多 10 页 / 2000 个去重模型，搜索结果选择框一次显示前 200 项，可继续搜索缩小范围。列表只保存在当前界面内存，不持久化。Provider、协议、地址或 Key 改动会中止旧请求并清除旧列表；不会清除 Model。

## 错误与安全边界

401 和明确无效 Key 错误归类认证失败；403 提示认证/账户/模型权限不足，不武断认定 Key 无效。可识别模型错误码提示模型不存在或无权限。列表 404/405/501 提示接口不支持或地址路径错误，保留手填能力。服务 5xx 提示地址服务暂不可访问；无效 URL、超时、取消、离线和其他错误分别提示。所有请求 20 秒超时。

CORS 拒绝时，Safari fetch 通常只抛出 TypeError，与 DNS、TLS、断网及重定向失败相似，前端无法可靠精确识别。界面明确显示“浏览器跨域限制（CORS）或网络错误”，说明请服务端允许当前网站来源，不能因此判断 Key 无效。不能声称可以自动区分所有 CORS 与网络原因。

第三方服务必须允许生产域名的跨域 GET/POST 与 Authorization 或 x-goog-api-key 等请求头预检；模型列表可访问也不代表聊天接口允许跨域。未使用公共 CORS 代理，不关闭浏览器安全限制。

只向可信 HTTPS 地址发送请求，不跟随重定向、不带 Cookie、不发送 Referer、不缓存。Key 仍为客户端本地凭据，安全边界不变。错误不透传原始响应或异常文本，无 console 输出；模型名称若回显当前 Key 会隐藏，包含 Key 的模型 ID 或分页令牌不会被用作后续请求。没有真实 Key 进入源码。

## 验证

自动化使用合成 Key 和模拟响应，验证所有适配器 endpoint、Gemini 分页、模型搜索/选择、当前表单真实请求构建、错误分类、20 秒超时、过期结果丢弃、失败不覆盖 Model 与已保存配置，并运行全部既有回归。没有使用个人付费 Key，不能声称所有厂商真实线上验证通过。

真实 iPhone Safari 的相应服务 CORS、原生模型选择器、键盘与滚动仍需手动验收。Vercel main 集成若保持有效，推送应触发部署，以实际 Ready 状态为准。

最终结果：`npm run typecheck`、`npm run build` 通过；全部 17 个 Playwright 综合用例通过（37.8 秒），包含原有全部 13 个回归用例。未提交测试自动生成的桌面截图变化。

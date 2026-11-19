# 公共 Railway 与独立 Supabase 接入契约（开发中）

## 已有公网入口
QQ bridge: `https://qq-qr-bridge-production.up.railway.app`。仅 `GET /health` 是公共健康检查；`/qq/qr/*` 需要服务端 token 和允许的 Origin。**不向浏览器公开 `QQ_QR_ACCESS_TOKEN`**。

## 当前阻碍
`workers/qq-qr/server.mjs` 从 `QQ_SUPABASE_URL` 读取单一 Supabase 地址。监听器恢复、AI 轮询、消息发送轮询和绑定确认均使用此地址。更改这个变量为朋友的项目会影响原用户，禁止如此操作。

## 目标连接流程
1. 用户在小手机保存自己的 Supabase URL 和 publishable key；前端验证格式、Auth、必要的 Edge Functions。
2. 项目所有者经 Supabase 官方授权完成 migrations、Edge Functions 与密钥配置；公开 key 不能用于部署。不能让用户在小手机输入 service_role。
3. 项目侧安装 `bridge-enrollment` 函数。公共 Railway 生成一次性 challenge，项目侧以仅服务端持有的注册凭据证明控制权。Railway 校验后保存 `tenantId/projectUrl/status/credentialVersion`，不保存数据库服务密钥。
4. 所有扫码、绑定确认、网关监听、AI tick、出站消息带 `tenantId`；绑定键为 `(tenantId,bindingId)`，并在 Railway 侧校验每租户授权、请求签名、过期时间、nonce 与速率限制。
5. Railway 只允许注册过的 Supabase 域名和 HTTPS；禁止任意 URL 转发和 SSRF；租户注销后停止监听、清除注册凭据。
6. A/B 两个测试项目验收：彼此消息/角色/密钥完全隔离，重启恢复正常；原用户功能不回退。

## 不能直接上线的原因
当前 QQ bridge 的 `/qq/qr/start` 没有 tenant 参数，`confirmBinding` 与所有 poller 固定调用单一项目。仅开放域名或修改环境变量不会实现多租户。必须先实现路由与授权，再灰度切换；保持 Production 不变。

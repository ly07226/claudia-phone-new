# 微信 AI 云端执行器：开发状态与安全门槛

已提交：
- `workers/wechat-listener.mjs`：监听 iLink 消息并入库
- `workers/wechat-ai-worker.mjs`：从**显式启用**的绑定领取消息，使用独立云端配置生成回复并持久化 outbox
- `supabase/functions/claudia-wechat-send/index.ts`：从 outbox 发送微信文字
- `20261116001100_wechat_ai_profiles.sql`：AI 配置默认 disabled，服务端专用
- `20261116001200_wechat_scoped_ai_claim.sql`：防止 AI worker 领取未授权绑定的消息

**尚未达到可部署状态**：
1. 缺少面向本人 Supabase 的、安全的云端 AI 配置授权/撤销端点。不能要求用户把 service_role 或 API Key 粘贴到不可信网页。
2. 当前云端 worker 只使用显式配置的 system_prompt 和云端微信文字历史；它**尚未**复现 Claudia Phone 浏览器内的世界书、长期记忆、角色配置、时间线和消息路径构建逻辑。因此不能声称角色上下文一致。
3. 本地小手机发送的消息尚未双向同步到云端 AI 历史。
4. 长轮询、扫码、AI 请求和发送接口均未通过真实账号、迁移或构建验收。
5. 需要测试 API provider 协议差异、网络超时、模型生成结果、出站确认、身份恢复、异常凭据轮换。
6. 不能部署多个监听副本，除非增加跨进程租约与游标原子提交。
7. 不要把用户数据、API Key、Supabase service_role 写入仓库、前端打包文件或日志。

部署前必须进行端到端测试：扫码→微信发消息→入库→AI 生成→发送→小手机同步，以及网络中断、重复消息、无权限角色、解绑和失败回滚。

当前所有代码仅在 `feature/wechat-ilink-integration`，不应合并到 main。

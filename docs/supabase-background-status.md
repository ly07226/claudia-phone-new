# Claudia Phone · Supabase 后台服务接入状态

> 本文是开发分支的真实状态清单，不是已上线声明。正式版 main 不受本次提交影响。

## 已由用户在 Supabase 控制台完成
- 新加坡区域项目创建，状态 Healthy。
- SQL Editor 执行 `202611140001_claudia_background.sql` 返回 `Success. No rows returned`。
- Table Editor 已目视确认四张 `claudia_*` 表存在。
- **尚未**在真实登录身份下验证 RLS，也未部署 Edge Functions。

## 已写入开发分支，尚未部署
- `claudia-push-subscriptions`：JWT 身份校验后保存/注销 Web Push 订阅。
- `claudia-enqueue-reply`：JWT 身份校验后登记带幂等键的后台回复任务；仅登记元数据。
- `PushNotificationSettings`：iOS 主屏幕应用本机通知测试与推送订阅界面，但当前同源 cookie 接口协议与 Supabase 跨域 Bearer JWT Edge Function **不兼容**，需要调整前端登录/请求层后才能联调。
- `public/sw.js`：通知事件监听；尚未验证通知点击后的聊天跳转。

## 还不能宣称可用的能力
1. Supabase Auth 登录、会话续期与多用户隔离的真实测试。
2. 前端使用 Bearer JWT 调用 Supabase Edge Functions，及受信任 Origin 设置。
3. 后台工作器读取队列、加载完整上下文、调用用户选择的 AI 服务商、写入结果。**当前任务表没有完整消息上下文或加密凭据，无法独立完成 AI 回复。**
4. 安全的 API Key 管理：绝不将用户密钥交给推送服务商，也不把密钥写入仓库；如要云端调用，需要明确的授权、加密存储/撤销策略，或改用平台提供的托管模型。
5. VAPID 公私钥生成与服务端秘密配置、实际 Web Push 发送、失效订阅清理。
6. 定时调度主动消息、失败重试、任务抢占与过期控制。
7. 真机 iOS 锁屏通知与切出应用后任务完成的端到端测试。

## 用户下一次需要做的操作（待联调时）
- 不需要每位小手机使用者创建 Supabase 项目；开发者维护一个后端。
- 需要开发者在 Supabase 项目中部署 Edge Functions，并在服务端配置受信任的应用域名和必要的密钥。请**勿**在聊天、GitHub 或 Vite `VITE_*` 变量中粘贴 service_role、数据库密码、VAPID 私钥或 AI Key。
- Supabase Project URL 与 publishable/anon key 是公开客户端配置，不等于服务端管理密钥。
- 在身份验证、前端协议、后台执行器和推送发送器完成之前，**不要把通知界面标记为已接通**。

## 安全约束
- 用户 ID 始终从经验证的 JWT 获取。
- `claudia_push_subscriptions` 对普通客户端不开放直接读取。
- 所有服务端写操作需再次检查用户身份与对象归属。
- 部署前必须审查 Origin/CORS、速率限制、服务端密钥管理、Web Push endpoint 出站限制、幂等与并发。
- 本分支未合并 main，未手动部署 Vercel。

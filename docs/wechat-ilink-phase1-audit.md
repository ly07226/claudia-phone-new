# 微信 iLink / ClawBot 接入：阶段一架构审计（初版）

状态：独立分支上的设计与静态审计；尚未接入微信、未部署。此文档不是全仓审计通过证明。

## 已核对的现有实现

- `package.json`：React 19、Vite 6、Dexie 4；前端不是可常驻监听的服务器。
- `src/Chat.tsx`：已存在 `cloudIdentity` / `cloudFunctionRequest`，仅在云端身份配置完成后报告聊天前后台状态；不能假定用户默认登录。
- `src/generationTasks.ts`：现有生成任务是浏览器进程内 Map，依赖 `chatService` 和 Dexie；页面关闭后不可直接由 Supabase Edge Function 调用。
- `src/ChatHub.tsx`：日常聊天设置按 `characterId` 和 `mode='daily'`、空 `worldId` 查询，已有主动消息选项，但当前测试依赖前台运行；微信主动消息不能直接复用其发送渠道。
- `src/chatHubTypes.ts`：社交模块数据结构独立，不应误当作微信 iLink 消息结构。

## 外部实现依据

Float: `tools/weixin-local-assistant/README.md` 与 `docs/weixin-cloud-assistant.md`。其云端实现采用 Supabase Edge Function + pg_cron，复用本地助手核心；其文档明确提示冷启动离线丢消息、微信 token 失效需重扫、动态世界书关键词激活不完整等限制。这些是 Float 的实现说明，不能自动视为 Claudia Phone 的验证结果。

## 第一版架构决策（待代码验证）

1. 仅开发独立分支；禁止写入 main 或自动部署。
2. 接入模块必须独立于现有浏览器生成任务：微信事件 -> 服务端验证/去重 -> 绑定的角色/日常会话 -> 服务端生成适配器 -> 微信回执 -> 同步记录。
3. 先只允许绑定单个日常角色；不接入剧本世界、分支时间线和其他角色。跨世界功能必须单独设计和测试。
4. 微信凭证、Supabase service_role 和模型密钥只能放在服务端受保护存储；不能直接写入前端、Git 或导出备份。
5. 用户主动扫码并授权才创建绑定；解除绑定必须停止轮询、清理凭证及任务。
6. 不依赖单纯内存锁。按外部消息 ID 做持久化幂等；生成前抢占租约，发送后记录回执；对“发送成功但记录失败”的模糊状态禁止盲目重发。
7. 云端消息与本地 Dexie 同步要有可重放游标、身份作用域和冲突规则；禁止从云端直接覆盖本地聊天。
8. 第一阶段先文字双向消息，再研究图片、语音和主动消息；主动消息的权限与速率必须实测。
9. Supabase Edge Function + pg_cron 为优先验证方案，若 iLink 长轮询与平台执行时长不匹配，则转常驻 Worker；不预设任一方案已稳定。
10. 任何微信接口不可用、账号无准入、过期、限流都要显式反馈，不能静默模拟成功。

## 下一轮必查

- `src/cloudIdentity.ts`、Supabase Functions/迁移及服务端鉴权边界。
- `src/chatService.ts`、`src/store.ts`、世界书和记忆构建入口，确认如何在服务端保持提示词等价。
- 数据同步的角色、会话、消息 ID 映射和删除/撤回规则。
- iLink 的授权二维码、凭证生命周期、消息游标、回复上下文 token 与主动发送权限，进行协议和真实账号测试。

## 阶段一通过标准

出具完整代码路径清单、最小数据模型、安全威胁分析、测试矩阵；未通过前不连接真实微信、不开放正式版入口。

# 微信消息处理 RPC：测试与后续实现

迁移：`20261116000100_wechat_daily_bridge.sql` -> `20261116000200_wechat_worker_rpc.sql`。

## 本轮实现
- `claudia_wechat_receive_text`：只接受 connected 且 owner 匹配的绑定；对外部消息 ID 幂等入库。
- `claudia_wechat_claim_inbound`：`FOR UPDATE SKIP LOCKED` 原子领取一条 received 入站消息；记录 `worker_id`、租约和尝试次数。
- `claudia_wechat_complete_inbound`：只有相同 worker ID 和未过期的同一租约才能确认成功或失败。
- `claudia_wechat_quarantine_expired`：超时 processing 标为 unknown，不自动再次调用模型以免重复扣费。
- 所有 RPC 仅授予 service_role 执行权限，浏览器用户不可直接调用写入。

## 重要未完成
- 当前 `generated` 仅表示模型生成阶段成功，不代表已生成持久化出站消息，更不代表微信发送成功。**不能直接拿它当已回复。**
- 仍缺少生成内容和出站消息的同一事务写入、outbox claim、发送回执及结果未知恢复；必须先实现才能真实调用模型。
- RPC 不验证微信协议签名或远端身份；调用者必须是单独的可信服务端入口，不能把 service_role 暴露给微信或浏览器。
- 当前没有执行真实 Supabase 迁移、测试数据库并发、微信端到端或 UI 同步。
- `p_worker_id` 由受控执行器随机生成并私有保存；不能让普通客户端提供后直连 RPC。
- 尚未实现限流、队列容量上限、滞留消息告警、用户主动撤销时清理队列。

## 部署前测试矩阵
1. 同一外部 ID 并发 receive：返回同一消息 ID，表中只有一条。
2. 同一个绑定不同方向/不同外部 ID：各自独立。
3. 未连接/跨用户绑定：receive 失败。
4. 10 个并发 claim：同一条消息只能被一名 worker 领取。
5. 错误 worker ID 或旧租约：complete 返回 false，不改变消息。
6. 过期租约：quarantine -> unknown，claim 不会重新领取。
7. anon/authenticated 直接执行四个 RPC：权限拒绝。
8. service_role 能执行 RPC；RLS 仅允许普通用户读取自己的消息。
9. 迁移重放不破坏现有数据；SQL 静态审查并执行测试项目后再上生产。

## 下一步
实现**事务性出站消息表 + 发送回执状态机**，并补上服务端入口、身份校验、测试。之后才连接 iLink。

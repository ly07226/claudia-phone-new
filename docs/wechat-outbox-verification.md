# WeChat Outbox 事务与回执验收

## 本次新增
- `claudia_wechat_finish_generation` 在同一事务中确认入站处理并插入唯一出站回复；旧的可单独标记 generated 的 RPC 已删除。
- `claudia_wechat_claim_outbound` 用 SKIP LOCKED 领取已生成的出站消息。
- `claudia_wechat_ack_outbound` 仅允许持有有效租约的 worker 写入已确认发送或结果未知。
- `claudia_wechat_quarantine_expired` 同时隔离超时生成和超时发送，均不自动重试。
- `in_reply_to` 唯一索引限制一个入站消息至多一条 AI 回复。

## 真实数据库必测（尚未执行）
1. 连续执行三份迁移；确认旧 complete RPC 不存在、新 RPC 权限仅 service_role。
2. 模拟同一 inbound 的两个并发 finish，只有有效租约的一个成功。
3. finish 发生 SQL 错误时，入站状态和出站插入必须一起回滚。
4. 10 个 worker 并发 claim_outbound，只有一个拿到同一条回复。
5. 错误 worker、旧租约、超时租约 ack 均不能修改状态。
6. 发送超时 -> unknown；不会再次被 claim_outbound 领取。
7. 绑定 paused 后不得领取新入站或新出站任务。
8. 用户 A 不得读取用户 B 的绑定/消息，普通客户端不得执行服务端 RPC。
9. 绑定解除后处理中的消息如何取消，以及实际微信发送前的二次绑定检查，需要服务端实现并测试。
10. 实际微信 API 是否返回可核验的发送确认、是否支持可靠消息 ID 尚待验证。

## 尚未完成
- SQL 未部署；测试未执行。
- 没有接入 iLink，不能扫码、收微信消息、调用模型或向微信发送。
- 还没有用户授权、云端模型配置同步、客户端增量拉取和冲突解决。
- 该状态机是 **at-most-once automatic sending attempt**，不是保证每条消息都最终送达；unknown 需要人工或协议支持的对账。

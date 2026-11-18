# 微信离线记忆：全历史来源检索与上线阻断项

## 本次修复
- `20261116001600_wechat_source_memory_search.sql` 提供 service_role 专用 RPC `claudia_wechat_search_history`，限制 binding、授权状态、快照边界、时间上界及返回数量；使用原始消息，不创建推断性永久事实。
- `workers/wechat-ai-worker.mjs` 不再从最近 500 条中检索；改为 RPC 查询整个符合授权边界的云端历史，选出有来源的片段。
- `claudia-wechat-ai-config` 更新已有快照时保留 `history_cutoff`，避免定时刷新导致尚未回填的云端消息永久失去检索资格。

## 当前局限
- 该检索是关键词子串匹配，不是语义记忆；结果受最近 12 条匹配及最终上下文预算约束。
- 在快照包含已回填微信消息时，保留旧边界可能导致重复注入；必须后续实现原始消息 ID 的精确去重，再允许安全推进边界。
- 当前不做 AI 自动总结。需要先设计摘要与原始消息的引用关系、幂等更新、撤销及纠错。
- `qrcode.react` 已在 package.json 声明但缺失于 package-lock.json；`npm ci` 预计失败。此执行环境无法访问 npm registry（DNS EAI_AGAIN），不能编造 lockfile integrity 或声称构建成功。
- GitHub workflow 已创建，但当前未确认任何成功运行。
- 未验证 SQL 迁移、真实微信 iLink、Supabase Edge Functions、后台 Worker 部署。
- 不得合并 main 或部署 Production。

## 下一步优先级
1. 在可访问 npm registry 的环境生成可信 lockfile，执行 `npm ci && npm run build`。
2. 运行 Node 检索测试与数据库迁移测试，检查函数返回类型和权限。
3. 对云端消息与本地快照做 ID 级精确去重，并检查并发快照刷新。
4. 再实现可追溯、可纠错的长期摘要及真实微信端到端验收。

# 2.3.3 聊天消息管理与多版本

仅开发消息管理，基线 bfe6051。没有加入长期记忆、摘要、RAG、Agent、语音或图片。Daily / World 的会话作用范围、角色与世界引用、世界书激活算法和 API 配置管理保持原有语义。

## 数据与迁移

IndexedDB v4 → **v5**，保留全部旧表、新增：

- `messageVariants`：id、conversationId、messageId、content、source（legacy/generated）、userEdited、createdAt。
- `messageRevisions`：id、conversationId、messageId、可选 variantId、原 content、createdAt。
- `conversationSnapshots`：id、conversationId、reason、createdAt、完整有效 messages 与这些位置的候选 variants。

Message 保留原 id、conversationId、role、createdAt 与 content；增加可选 activeVariantId、archived、userEdited。content 是当前选中版本的物化副本，写入时在同一事务更新；上下文读取仍校验并采用 activeVariantId 对应的版本内容，缺失时退回已存 content 避免空白。

升级在事务中把旧 assistant 消息创建为一个 legacy 版本并补 activeVariantId，不修改原消息 ID、内容、顺序、Conversation ID。旧 user 消息与所有 API、世界、角色、主题、桌面、资源、世界角色关联及世界书表不改写。版本、快照与归档都会占用本地存储；空间不足时操作事务失败，不以自动清理历史作为替代。

## 有效路径和重新生成

`src/messagePath.ts` 的 activeMessages 是 UI 与 chatContext 共用的有效路径读取入口：只读指定 conversationId，排除 archived，按 createdAt 与稳定 ID 排序；assistant 只选择该消息所属的 activeVariant。候选版本、修订和快照表不会整体进入 Prompt。

普通发送保存 user，回复成功后在一个事务内创建 assistant 位置、generated 版本和选择指针。重新生成复用 src/chatService.ts 的同一请求链、API 优先级、Provider/Custom 适配、60 秒超时、90 秒持久化租约和每分钟 20 次本地频率保护。

重新生成调用 buildContext(conversation, beforeMessageId)，严格截取目标 assistant 之前的有效路径，排除目标所有版本及其后续。成功追加版本、默认选中新版本，消息位置 ID 与时间不变；失败不改原回复或版本选择。最新回复左右箭头直接持久化切换；刷新保留候选与选择。

历史回复的箭头打开“预览（尚未应用）”面板，不写入选择、不触发世界书、不进入 Prompt。确认“使用此版本”后才正式切换；必须提示剧情风险，先保存完整快照，再归档后续消息。历史重新生成也需确认，并只在成功写入新版本时保存快照和归档后续，失败保留旧路径。

## 编辑、撤回、删除

- 用户编辑：多行预填、空白拒绝、取消不写库。仅保存会归档不再匹配的后续回复；最新 user 也可“保存并重新回复”，基于新内容调用真实 API，建立新分支回复。原回复保存在快照而非直接覆盖。
- AI 编辑：只修改当前候选版本，其他候选不变；保存原文为可恢复修订，标记“用户已编辑”，不增加伪造的 API 生成版本。修订列表仅属于当前消息及候选，可明确恢复原文；恢复本身也保留新的修订。
- 编辑有后续的历史消息：确认后，先完整保存原路径，再将后续设 archived，修改目标。保存内容与修订、快照、归档是同一事务，不把新旧内容同时放入上下文。
- 撤回：只允许当前有效路径最新 user，不限时；取消生成，保存快照，将 user 及其后续回复归档，可选择把原文字放回输入框。旧 user 的撤回入口禁用，服务层也校验。
- 删除：明确确认后，将目标及后续从有效路径移除，并保存快照。AI 删除整组位置而非仅删当前候选；user 删除同时移除对应回复，避免留下错误关系。消息、版本仍可通过快照恢复。
- 复制：复制当前正式文字或明确预览的版本。HTTPS Clipboard 被浏览器拒绝时提供只读文本框手动选择复制，不假报成功。

## 快照恢复

聊天页面“历史快照 / 分支恢复”按 Conversation 查询，提供查看与恢复。预览最多显示最近 30 条，但恢复完整快照。恢复前先保存当前路径的新快照，随后恢复所选快照的消息 ID、文字、版本选择与候选内容，其他路径只归档，不合并剧情、不永久丢失。该位置在后续产生的其他候选仍保留，可明确选择；只有正式选中版本进入上下文。

所有恢复都校验 conversationId、messageId、variant 所属关系，不能恢复到其他空间。删除整个 Conversation / World / Character 时，沿用现有明确确认行为，并同步清除对应的消息版本、修订及快照，避免跨空间残留。

## 上下文和世界书

chatContext 的最近 30 条 / 24000 字符基于当前有效路径计算，再把同一份有效历史传给原 Lorebook Engine。未选版本、修订、撤回/删除消息和归档快照都不参与关键词扫描。世界书的 Constant / Regex / Probability / Position / Depth / Role 算法未更改；Daily / 各 World 范围仍由原会话隔离。

## 并发与失败

- 同一 Conversation 仅持有一个有效生成令牌，重复生成被拒绝；普通发送与重新生成共享该锁。
- 修改、切换、恢复、撤回或删除会取消本标签页请求并使持久化令牌失效。BroadcastChannel 发送带令牌的取消通知，避免旧取消事件误伤新请求；不支持该 API 时仍靠数据库令牌阻止迟到写入。
- 回复写入事务再次校验令牌、会话、目标有效位置及取消状态。即使 Provider/网络忽略取消，旧响应也不能覆盖当前路径。
- 编辑器会比对打开时的正文及 activeVariant，发现并发修改则拒绝覆盖并提示重开。
- API 出错不泄露原始 Provider 错误或 Key。版本写入失败整体回滚，不留下空消息组，也不丢失历史后续。保存用户修改后再生成失败时，修改和原路径快照仍保留，用户可重试。

## iPhone 与可访问性

气泡长按 500ms 打开底部操作面板，位移超过 10px 或 pointercancel 取消长按；不在 pointerdown 阻止滚动。长按触发后抑制后续点击，面板不把同一次长按松手误判为点击空白。每条消息有常显省略号按钮，桌面及键盘可访问，不依赖 hover/右键。

面板支持空白关闭、Escape、Tab 范围约束和关闭后恢复焦点。VisualViewport 调整面板高度/位置，编辑区可滚动，保存取消固定在可见区域。文本使用 React 纯文本渲染，不执行消息 HTML。切换版本或本地操作不会强制滚到底部，只有打开会话/正常发送后自动定位。原聊天容器焦点偏移修正仅用于聊天页面显示。

## 验证与生产复验

自动化使用合成凭据及模拟 HTTP 响应，不声称已用真实付费 Provider 或真实 iPhone 验收。覆盖旧 v4 全表迁移比对、多版本成功/失败/刷新、选中版本上下文、历史预览/正式切换/恢复、编辑/修订、撤回/删除、实际请求进行中撤回、忽略取消的迟到响应、跨标签取消、写入事务回滚，以及真实 Chromium 触摸事件长按和全部既有回归。

旧兼容回退测试随 v5 增加新表声明；不得直接将已升级设备回退到只声明 v4 的旧构建。若需恢复 2.3.2 功能，应正常 revert 2.3.3 并保留 v5 的三个表声明，不清库、不降级、不 force push。原消息内容物化字段仍可读，但旧聊天代码不认识 archived，因此不能在保留归档消息时原样使用旧 chatContext：安全回退还需保留有效路径过滤，或先提供只读模式。未自动执行任何回退。

真实 iPhone Safari：长按与文本选择、剪贴板权限、键盘下按钮可见性、长记录滚动、后台/多标签取消，以及真实 Provider CORS/参数仍需人工复验。Vercel 正常监听 main 时应自动部署，具体结果以提交检查为准。

最终执行结果：`npm run typecheck`、`npm run build` 通过；全部 40 个 Playwright 综合用例通过（约 1.2 分钟），包括原有全部 29 个回归及新增 11 个消息管理用例。旧用例仅因合法 v5 升级更新版本断言与回退兼容声明，原功能断言保留。生成的测试截图不纳入源码提交。

# 世界书 / Lorebook · 2.3

入口：设置 → 世界书 / Lorebook。可新建、重命名、描述、启停、删除世界书，编辑默认扫描深度与预算；条目可新增、编辑、启停、删除，支持基础与折叠高级设置。使用手机标准 Files picker 导入 JSON，导出后点击下载链接保存到文件。列表每页 30 条，可按名称与关键词搜索。

## 数据与作用域

Dexie v3 → v4，仅增加两张表，不删除或重写任何旧表记录：

- `lorebooks`：id、name、description、enabled、sourceType、global、worldIds、scanDepth、charBudget、createdAt、updatedAt、rawMetadata。
- `loreEntries`：id、lorebookId、title、content、primaryKeys、secondaryKeys、enabled、constant、selective、selectiveLogic、priority、insertionPosition、scanDepth（null 继承）、caseSensitive、时间、compatibilityIssues、rawMetadata。

worldIds 是用户主动选择的绑定集合，允许零个或多个世界、多本书绑定同一个世界。仅绑定世界的书不进入 Daily，不会进入其他世界。Global 需明确勾选，可进入日常及所有世界。导入副本默认不设全局、不绑定世界，防止外部文件擅自扩展作用范围。删除世界后残留的绑定 ID 不会匹配其他新世界；删除书只删书与条目，不影响世界、角色、API、会话和消息。

没有预设或自动创建任何世界、条目或角色。

## Prompt 激活

`src/loreEngine.ts` 接收当前 Conversation 和已按 conversationId 隔离的有限历史；`src/chatContext.ts` 统一调用。

1. 选择启用且 Global 或绑定当前 worldId 的世界书，Daily 仅选择 Global。
2. 跳过停用条目与有未确认兼容性问题的条目。
3. Constant 直接成为候选；普通条目以确定性的字面子串匹配扫描最近消息，默认不区分大小写，可启用大小写敏感。不是正则，也不按整词匹配。
4. primaryKeys 任意命中；selective 为 true 且有辅助词时进一步应用 selectiveLogic：0=任意辅助词命中、1=并非全部命中、2=全部未命中、3=全部命中。空辅助集合不额外限制。常驻不受关键词和辅助条件限制。
5. priority 越大越先，同优先级按创建时间、稳定 ID 排序。没有递归激活，条目内容不会触发其他条目。
6. 在预算内完整选择条目，不切断内容；不够预算的条目跳过，再检查后续较短条目。
7. 仅 Content 按 before-profile / after-profile 插入唯一 system 消息中的基础资料前后。标题、编辑器备注、原始元数据不发送给模型。

每本预算默认 4000 字符（100–8000），跨书新增内容合计最多 8000 字符，同时受原系统提示 24000 字符总预算约束。扫描深度默认 10 条，书与单条均可设 1–30，只扫描本会话已保留的有限历史。字符预算是近似保护，不是模型 Token 计数。常驻表示每次进入候选，也可能因禁用、兼容暂停或预算不足而未注入；不承诺模型 100% 遵守规则。

## 导入适配

`src/loreImport.ts` 独立完成格式识别、归一化、验证和安全导入。

支持：

- Claudia Phone Native JSON，`format: claudia-phone-lorebook`、`version: 1`。
- 常见 SillyTavern World Info：entries 对象或数组；基础 Tavern 风格 entries 数组。不是全版本、全插件兼容，不解析角色卡 PNG 或压缩包。

| 外部字段 | 内部映射 |
| --- | --- |
| uid | 保留于 rawMetadata；内部重新生成稳定 UUID |
| key / keys | primaryKeys |
| keysecondary / secondary_keys | secondaryKeys |
| comment / title / name | title，仅用于管理 |
| content | content |
| constant | constant |
| selective、selectiveLogic 0–3 | 辅助关键词条件 |
| order / insertion_order | priority，较大值优先 |
| position 0 / before_char | before-profile |
| position 1 / after_char | after-profile |
| disable / enabled | enabled，disable 优先 |
| scanDepth | 条目扫描消息数，null 继承 |
| caseSensitive | 大小写匹配 |
| depth | 原始提示插入深度，绝不冒充 scanDepth；非基础插入位置暂不执行 |
| probability / useProbability | 保留原值；非 100% 概率条件暂停执行 |

不完全支持：其他插入位置/消息深度、随机概率、正则关键词、未知 selectiveLogic、插件及未知高级字段。未知条目字段保留于 rawMetadata 并显示警告，该条目暂停注入；用户可查看问题、修改已支持参数，再明确“确认转换为基础规则”。原始元数据仍保留。顶层未知字段也保留并警告。对基础前/后位置，外部 depth 没有实际插入作用，因此只保留元数据，不误用为扫描深度。

文件选择后只在内存预览：显示格式、名称、条目数、可转换数、兼容问题数及字段警告。无效条目标明跳过；确认后才写入。文件最多 5MB、3000 条，内容每条最多 20000 字符、全书最多 200 万字符。完全无效或不可解析文件不写库。有效空世界书可以导入。

导入总是创建新书与新条目 ID，不覆盖已有书；book 与 entries 在同一 Dexie 事务中 add/bulkAdd，任一步失败整体回滚。导出仅查询并序列化世界书与条目，不读取 API Key、聊天或角色数据。Native 导出保存核心字段、已支持高级设置、兼容标记及原始元数据；再次导入创建独立副本，安全起见重新选择 Global / World 作用范围，时间与 ID 重新生成。

## 验证和部署

测试覆盖 Native 管理持久化、启停、常驻与关键词、未命中与禁用不注入、辅助逻辑、预算、三空间作用域、标题不注入、SillyTavern 转换与未知字段、确认前无写入、Native 往返、失败不覆盖、事务回滚及 v3→v4 所有旧表逐表保留。继续运行原有 API、聊天、隔离、桌面回归。

原有回退兼容测试已随数据库版本增加 v4 表声明，验证旧行为回退时保留当前完整 schema 不会删除数据。生产回退不可直接上线只声明 v3 的旧版本；应正常 revert 功能并保留 v4 兼容表声明，不降级或清库。

iPhone Safari Files picker、下载到“文件”、键盘和大型文件性能仍需真机验证。未引入长期记忆、向量检索、自动摘要等功能。

最终验证：`npm run typecheck`、`npm run build` 通过，全部 21 个 Playwright 综合用例通过（45.1 秒），含原有 17 个回归用例。测试截图变动未纳入提交。

# 2.3.1 世界书真机体验修复

## iPhone 导入

设置 → 世界书 / Lorebook → 页面顶部全宽 **从 JSON 导入世界书**。真实 button 在同步点击事件内调用专用 file input.click()，不依赖透明遮罩或 hover，不经过异步等待后触发 picker。input 接受 .json / application/json，保留原“导入世界书”可访问标签以兼容测试。Files picker 选择文件后：读取 → 格式识别 → 转换/校验 → 预览 → 用户确认 → 同一 IndexedDB 事务写书及条目。失败不覆盖已有数据，重新选择同一文件也可触发事件。

## Entry 编辑

保留 Comment / title（不进 Prompt）、长文本 Content、多关键词、Constant、Enabled、Order；新增 Regex 开关和独立测试文本、明确 Position、注入 Depth、Role、启用概率与 0–100 数值，以及复制 Entry。辅助关键词 / selective / selectiveLogic / 大小写和 **关键词扫描深度** 保留在折叠高级区。

普通关键词用逗号/换行分隔；Regex 每行一条，不拆表达式中的逗号，支持 `pattern` 或 `/pattern/flags`。条目卡片可展开查看内容及参数，折叠时显示名称、启停、激活方式、关键词摘要。点击编辑可修改全部字段，内容编辑区最小 240px。

## 数据兼容

数据库仍为 **v4**，没有新表/索引或迁移。旧条目在读取/执行时用 normalizeEntry 补默认字段：regex=false、insertionDepth=0、role=system、useProbability=false、probability=100，不主动重写旧记录。旧兼容性暂停条目不自动解除；可重导原始文件或手动配置后确认转换，避免自动改变旧高级语义。

新增字段随 Native 导出/导入保留。复制生成新 ID，其他参数、原始元数据和兼容标记保留，不自动解除暂停。

## 激活与位置

纯函数 `entryActive`、`planLore`、`injectLore` 位于 src/loreEngine.ts。planLore 返回最终 selected entries / activated IDs / regexErrors，便于测试，无 API Key。

流程：当前 Conversation 授权范围 → Enabled 与兼容状态 → Constant 或 Keyword/Regex → 辅助条件 → Probability → 稳定排序与预算 → Position / Role 注入。书和条目预算、总预算继续生效；有较大 Order 的条目优先，随后 createdAt、ID 字典序稳定排序。预算选择依据此顺序；最终按位置归组，每个位置内保持稳定顺序。

明确 Position enum：

| 内部值 | 实际位置 |
| --- | --- |
| before-profile | 角色基础系统资料前 |
| after-profile | 角色基础系统资料后 |
| before-conversation | 所有保留的聊天历史之前 |
| after-conversation | 所有保留的聊天历史之后 |
| at-depth | 按原始保留历史计算插入槽位 |

scanDepth 只决定扫描多少条近期原始聊天消息。insertionDepth 只决定激活后的插入位置：0=历史末尾；1=最后一条历史前；超出历史条数则放在历史前，限制 0–30。插入的世界书消息不参与深度计数，也不递归触发其他条目。

默认 System 的 profile 前/后仍合并在初始 system 消息中，兼容 2.3；非 System profile 条目以独立消息放在基础资料两侧。Before/After Conversation 和 At Depth 使用独立消息及所选角色。

概率仅在其他触发条件满足后应用；关闭时不抽样，0 永不触发，100 始终通过概率门槛，其他值比较 `random() < probability/100`。随机函数可注入，测试不依赖偶然结果。常驻仍受 Enabled、兼容暂停、概率和预算约束。

## Regex 安全

编辑阶段编译校验并显示错误，非法表达式不能正常保存为可执行规则。外部非法表达式保留内容及原始字段、显示兼容警告并暂停，不使聊天崩溃。语法正确但危险的表达式在独立 Worker 执行，最多 1 秒后终止；该批正则条目本轮跳过，普通条目继续。调试结构/独立测试显示失败。Worker 不访问数据库或 Key，不记录聊天文本。

## Role 与协议

OpenAI / Compatible / OpenRouter 原样发送 System/User/Assistant。若上游用 HTTP 400/422 明确标识角色不支持，最多重试一次，将资料按原顺序转为有标识的 User 参考消息；不会对认证、额度或其他错误盲目重试。

Gemini 只有单一 systemInstruction：初始系统资料保留；历史内 System 在原槽位降级为带 `[系统设定资料]` 的 User；Assistant 转 model。连续同角色合并，必要时首尾 model 降级为 User 参考资料，避免不兼容的前缀补全。此降级保留内容与相对位置，不意味着 System 权重相同。UI 明确说明。

API Key 安全边界不变，不打印原始错误或完整 Key。Daily/World 的 Conversation、消息查询与作用范围规则未改变。

## SillyTavern 兼容

继续映射 uid/key/keys/keysecondary/comment/content/constant/selective/selectiveLogic/order/disable/enabled。新增支持：position 4 / at_depth → at-depth；depth → insertionDepth（绝不当 scanDepth）；role 0/1/2 或 system/user/assistant；probability/useProbability；regex/useRegex 和关键词的 `/.../flags`。混合普通词与斜线正则时将普通词转义以保留字面含义。

仍不宣称完全兼容：作者备注、示例、扩展插入位置、插件/未知字段、未知 Role 和 selectiveLogic、复杂外部条件与递归行为。保留 rawMetadata、预览警告并暂停不完全兼容条目。Native 扩展字段往返保存。有效空书、部分无效文件和事务失败保护保留。

## 验证

新增自动化覆盖实际 button 点击引发 filechooser、ST 完整字段、手机编辑/复制、Regex 语法和 Worker 超时、概率 0/100/mock、稳定排序、位置/深度与扫描独立、最终 API 角色、Gemini 降级、明确角色错误的一次回退以及旧 v4 缺省字段。继续运行原有全部 21 个综合用例。

自动化 iPhone 视口不等于真实 Safari，生产部署后的 Files picker、键盘、长文本、Worker 冷启动、角色兼容和真实 Provider CORS 仍需真机验收。没有创建示例内容或开发下一阶段。

最终执行结果：TypeScript、Production build 通过，全部 26 个 Playwright 综合用例通过（52.5 秒），包含原有全部 21 个回归用例。数据库 schema 文件未修改，自动生成的测试截图变动未提交。

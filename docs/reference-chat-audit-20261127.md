# 旧聊天专项审计与重构（2026-11-27/28）

## 状态与范围

工作分支 `refactor/reference-only-chat-snapshots-20261127`。基线 main 为 `71805e3fa34813c1880bc479ffe20ce7c8f2ce84`，开始审查时已有分支成果为 `f7194a877996093aeee33563ac4ee0782650377d`。前者是后者祖先。保留原有八次提交，在独立 worktree `/workspace/claudia-reference-chat` 开发；没有重置、清理或更改原 `/workspace/claudia-phone` 中的用户修改，也没有合并 main、部署或调用模型。

**本报告不是全部需求完成的声明。** 当前最重要的未完成项是：正文尚未在所有存储投影中只保留一份；废弃分支、淘汰回复尚未自动回收；没有真实 iPhone 测试条件。未达到无条件合并标准。

## 已确认的问题、证据与修改

| 问题 | 复现/证据 | 处理 |
|---|---|---|
| 输入仍触发高成本父组件更新 | 原分支输入 56 字符，React commit hook 记录 Chat 更新 56 次，1k/5k/10k 均重现 | `ChatDraft.tsx` 中每会话独立外部 store，只有 textarea/发送按钮订阅；Chat 仅读取事件发生时的最新值。相同断言现在为 0 次。图片异步处理通过 getter 读取最新草稿；保留 IME、发送、取消、引用和附件 |
| 有废弃分支时追加退化为全历史扫描 | `tryAppendProjection` 比较全部 message 行数与当前有效节点数，回退编辑后两者永久不同。原分支追加读取 1k/5k/10k 行 | 记录最近事务核验的全部行数，按新增 ID 增量验证；外部事务创建、编辑、删除、回滚仍使证明失效。负向测试覆盖总行数相同的“删归档+外部新增”，避免漏消息 |
| 超过 8Mi 后发送突然变慢 | 11,008,890 字符、10k 消息+5k 版本行，实际 UI 发送 6,110ms、20,038 次 pathNodes.get；新反向断言 `<200` 在修复前失败 | 以现有复合索引读父链/指纹元数据，只批取目标路径正文，每批 128，仍逐项验来源/父链/指纹；不再先读取 8Mi 正文后放弃并逐节点回退 |
| 发送与节点构建重复读取 | 普通本地发送为获取末条时间戳，先解析完整历史；构建一条新节点还预加载所有分支正文候选 | 无引用发送只读 1 条头部，引用仍校验完整来源；少量候选走索引点查，大改写超过 16 次查找后才用仅 ID 的候选图。省去正常追加的全图正文预载 |
| 快照写入仍是 O(N) 元数据复制 | 起始分支 V2 每次保存 messageIds/variantIds；10k 快照约 79KB | 新写 V3 仅保存 timeline/head/epoch，约 340B、最多一个节点 get；V2 和旧内联快照仍可读。头指针不是越权许可，恢复仍验证归属、完整路径、指纹 |
| 引用快照预览为空、ZIP/导入不兼容 | 新快照 inline 数组为空，旧预览与校验仍只检查 inline，导入遗漏 nested references 映射 | `snapshotPreview.ts` 验证并读取至多 30 条预览；`snapshotReferences.ts` 统一 V2/V3 校验；ZIP 全图校验及 `importPlan.ts` 同时映射内外引用 |
| 编辑后恢复快照取到了可变版本正文 | 先快照、再编辑 assistant variant、恢复后得到编辑后的文本，负向测试在旧实现失败 | 用不可变节点中的正文、编辑标记、心声、中断状态恢复；版本标识/历史元数据保持。顶层 undefined 与缺省字段按实际指纹语义比较，未放宽正文/归属校验 |
| 远端引用被误判已删除 | 引用目标在分页窗口外时按钮永久 disabled | 区分“尚未加载”与“真正不存在”；只允许作用域匹配的未加载引用，读取后再核对版本/part/role；分页不伪造原文 |
| 编辑/回退后丢失引用阅读位置 | 刷新先换成尾页，目标未加载时 jump 标记提前消费 | 独立保存显式阅读锚点，在正确作用域页读取完成后定位；真实滑动/新发送/离开清理意图，避免强制留在旧锚点 |
| 历史定位多次数组头插、逐条请求慢 | 10k 历史跳转及分支返回曾超过现有 5s 断言 | 收集页块后一次 reverse/flat；定位页 120 条；可信已核验 ID 仅作为 bulkGet 提示，真实节点仍在同一事务逐项验指纹、归属和父链；原生 IDB 篡改负向测试仍拒绝 |
| 在途分页丢掉引用点击 | 阻塞一次真实上翻读取，再点击旧消息引用；原布尔锁直接 return，受控用例 5s 内找不到目标 | 让引用等待当前分页 owner 的完成 promise，并在 finally 释放；同一时间仅一个读者更新 cursor |
| 同一路径的元数据刷新取消有效引用 | 不改消息和时间线，仅更新 conversation.updatedAt，原 refreshTicket 仍使合法页面被丢弃；独立负向用例复现 | 保留真正的导航序号、会话/分支/epoch、head-key、cursor 与正文校验，移除多余 UI 刷新序号；重试未完成定位，真实导航或新发送可以取消旧意图 |
| legacy 列表预览长久陈旧 | 无 activeTimelineId 时 undefined===undefined 使旧 projection 被当作有效；在 main 基线复现 | 只对存在真实 active timeline 的投影启用持久缓存，legacy 仍走有索引的最新消息查询 |
| ZIP 候选数据库版本滞后 | main 已是 v9，隔离恢复库仍初始化 v7，真实读回报“数据库版本或表结构未受支持”；在 main 基线复现 | 仅修隔离候选库，支持准确的 v9 归档 schema，旧候选在原 schema 校验后加法升级；保留旧贴纸、映射 scope；冲突图片明确拒绝，不覆盖现有用户数据。live DB 没有版本升级 |
| 流式 ZIP 错误映射漏掉密码失败 | 普通 reader 映射已存在，streaming `.read()` 漏掉，主界面错误成 BACKUP_UNKNOWN | 两条流式入口复用既有 zipError 的明确错误分类，实际加密 ZIP 错密码失败后仍可输入正确密码恢复 |
| 小高度扩展输入面板超出底部 | 375×360 采样 footer.bottom=363.59、stage.bottom=360 | 仅有扩展面板时允许其 flex-shrink，其他 footer 控件不缩；不改正常高度、定位偏移或导航视觉。375/390/430 和短高度实际布局测试 |

## 保留的有效机制与替换的旧路径

- 保留已有首屏 36 条读取、60 组可变高度双向 DOM 窗口与 overscan，不再另建第三套列表。`HistoryLayout` 的 Fenwick 索引、图片/时间标签测量、同一 ChatMessage 气泡组件继续使用。
- 替换 Chat 父组件草稿 state 驱动路径；移除旧 text 参数对视口 effect 的依赖，使用原生 input 与程序更新事件合并到现有 RAF 调度。
- 移除从未赋 true 的 `displayFullyLoaded` ref；不保留这个无效缓存分支。
- 替换 V2 全路径 ID 清单写入，保留其只读兼容；没有移除旧存档读法。
- 替换用活动路径长度校验全部存储行数的错误快路条件。
- 对没有引用的普通气泡，不再传入全局历史数组/索引作为 props；未变化的版本组沿用引用，保留事件处理器的新鲜值。
- 引用导航不再反复 unshift 累积数组。没有删除真实性校验或用缓存正文代替数据库真实来源。
- 删除 `scopedGraph` 的“先全分支正文读取、超字节阈值后放弃并回退逐节点”的读法；替换为元数据图和目标路径批量正文。50k 节点以上仍保留安全的有界回退，未伪称无限规模常量耗时。
- `ResizeObserver`/scroll 测量已有 RAF 合并与高度差阈值，没有叠加轮询、强制滚动或机型固定高度。

## Float 的实际代码调查

实际读取上游 `xiaolongbao0709/ai-virtual-phone`，提交 `d9ca6fab12112bdefe1751207aba4c4d13c63359`，而不是仅根据 README 推断。

- `components/chat/chat-room.tsx` 的 ChatTextInputBar（约 600 行）是 memo/forwardRef，输入状态局部保存，离线输入组件也类似；这与本次隔离方向一致，独立实现，未复制源码/素材。
- 同文件 visible window/loadMore 限制首屏展示。
- `lib/chat-storage.ts` 约 1129 行的历史读取先 `getSortedSessionMessages(sessionId)` 再 slice，因此该仓库并不能直接证明“数据库读取为常量复杂度”，没有机械移植其存储方式。
- Claudia 的不可变分支、证据指纹与 ZIP 校验需要单独兼容，不能用另一项目的数组 slice 替代。

## 数据、功能与安全边界

- 新快照不复制正文，但 `messages`、`messageVariants`、`pathNodes.message` 仍保留现有多投影正文。**正文只保存一次未完成。**这需要独立的 canonical-body/引用迁移和完整旧备份验证，不能仅删数组后冒充完成。
- **废弃分支自动 GC 未完成。**当前仍保留回退可恢复数据；没有删除用户历史。安全回收必须遍历 live timeline、快照、引用、记忆来源及任务引用后再决定，不可按年龄/当前可见性直接删。
- legacy 首次迁移、完整生成上下文、显式完整搜索/导出仍可能读取全路径；8Mi 字符私有缓存阈值、50k 节点上限和跨窗口不复用证明的保守策略仍存在；新读法不再因字节阈值自动退回逐节点。legacy 无时间线且全部时间戳相同的极端导入仍需读取完整同时间组以保留旧排序，不保证该路径常量首屏成本。
- 60 是消息组上限而非气泡数量：一条超长多气泡回复仍可能产生大量 DOM；任意用户 CSS、伪元素尺寸与复杂动画无法保证无性能损耗。
- 未改变分气泡、人设、记忆内容、API、模型配置、Provider、QQ、小游戏、Story 或正式环境。
- 首屏本来已经有有效的 bounded 优化，本轮没有把它的收益全部算成新改动。真实旧 iPhone 多秒停留尚未复现到同等程度；不能以桌面 Chromium 的短文案 fixture 声称解决全部真机问题。

## 验证与性能记录

最终结果与可复现命令见配套 [metrics JSON](reference-chat-metrics-20261127.json)。最终运行代码提交为 `72515590a8cff37b5da700f155c5d15808f15cd7`；下方保留 b412 中间样本，并单独列出最终重测，未混为同一次测量。所有浏览器数据来自本地 Chromium、iPhone 尺寸模拟与隔离的 synthetic IndexedDB；不是真实 iPhone Safari，也不是真实模型延迟。测量不含造数据时间。测试只请求本地/route 模拟 API。

测试同步没有删除业务断言：旧 retry 按钮名、相册入口、背景 pseudo-element 读取及 schema v8→v9 期望与当前 main 一致；旧 32MiB ZIP 入口限制测试改为当前压缩输出上限和损坏/不完整/取消/弱密码断言；历史遍历仍逐项确认全部 ID；缓存篡改仍反向验证失败。

环境重启中断到第 173 项的回归、早期 exit 1 和 baseline 反向失败都不算通过；最终仅去重汇总完整运行结果，不叠加重复执行次数。

WebKit 二进制存在但缺少 GTK4、Graphene、Harfbuzz ICU、Manette、Hyphen、GLESv2 系统库，无法启动；真实 iOS/PWA 的键盘、合成层、白闪和帧率均未验证。

## 发布边界

保持 Draft PR，不合并 main、不主动部署。此分支加入现有 hosting denylist、commit 使用 skip ci/netlify 标记，避免重复云构建；不会修改 main 生产构建策略。不更改环境变量或域名。

### 已保留的基线失败

`tests/raw-history-recall.spec.ts` 的“4至14天旧事件按相关话题召回，较新明确态度优先于旧偏好”（约 80 行）要求最终上下文包含 `较早的身体状态应先确认`。当前 main 的 `rawHistoryRecall.ts` intro 没有该文案；独立 main worktree 同一用例也失败。本次仍保留该断言，没有为性能 PR 修改记忆提示词、跳过测试或把失败算成通过。记录是否召回与这条提示约束是不同检查，后者仍需处理。

### 复现命令

- 安装：`npm ci`（首次 sandbox 的 esbuild 安装被权限拒绝，授权的正常安装成功；没有把失败算成功）。
- 编译：`npm run typecheck`、`npm run build`。
- 去重主回归：`node scripts/test-reference-chat.mjs --reporter=list,json`，选择等同正式 `test:chat-regression` 加本次受影响文件并去重。
- 增量证明反向基线：在 f7194a8 上运行相同 `tests/archived-append.spec.ts`，预期出现全表读取行数断言失败。
- 输入隔离反向基线：在 f7194a8 上运行相同 `tests/chat-draft-isolation.spec.ts`，原 Chat commit 数为 56，不是 0。
- 性能串行测量：`npx playwright test tests/performance-render.spec.ts tests/performance-audit.spec.ts tests/chat-draft-isolation.spec.ts tests/snapshot-cost.spec.ts tests/archived-append.spec.ts --workers=1`。基线的改善性断言会失败，数据在断言前输出；这不是基线“通过”报告。
- 大正文：`npx playwright test tests/chat-large-body.spec.ts --workers=1`，另外保存 assistant 版本行，不只用短文本证明性能。
- 恢复扩展：`npx playwright test tests/restore.spec.ts tests/restore-prerequisite.spec.ts tests/backups.spec.ts tests/private-notes.spec.ts tests/character-life.spec.ts tests/character-life-integration.spec.ts tests/story-storage.spec.ts --workers=2`。
- 云构建保护：`node --test tests/automation-build-policy.test.mjs`。


## 串行性能实测（最终读取机制）

相同机器、Node 24.19.0 / npm 11.9.0 / Playwright 1.64.1、本地 Chromium、单 worker；基线 f7194a8 与最终代码依次运行，没有在测量期间并行运行构建/其他浏览器套件。以下是单次观察，不是均值、p95 或真实 iPhone 指标。

| 消息数 | 首屏 before→after ms | 56字输入 Chat commit before→after | 同输入耗时 before→after ms | 保留归档分支后的热追加 before→after ms | 快照 before→after bytes |
|---:|---:|---:|---:|---:|---:|
|1,000|133→115|56→0|302→195|67.4→6.2|7,260→339|
|5,000|129→141|56→0|257→178|212→6.0|39,262→341|
|10,000|138→144|56→0|385→166|393.6→6.0|79,262→341|

首屏原本已有有效优化，**没有证明首屏耗时进一步显著改善**。首屏均 36 组、滚动后最多 60 组，不是限制保存条数。热追加的完整 messages 行读取由 N 降为 0；原始行数分别为 N+2，没有清掉归档来提速。快照单节点 get ≤1，首屏独立读取固定 36 行。5k 快照一次 IDB 调度出现 12.8ms，其余最终为 1.5/1.8ms，原始观察保留而不挑最快数。

### 必须单独披露的长正文冷发送

每条约 1,100 字符，assistant 还保存真实结构的版本行，不是只用几字的历史模拟长期使用。下面比较中间正确性修复 c4be125 与最终 reader；最初 f7194a8 在该夹具发送失败，不能把失败耗时当作 0ms 或有效速度基线。

| 消息数 / 正文字量 | reader前冷发送 ms | 最终冷发送 ms | 最终首屏 ms | 最终挂载组数 | 正文/版本保留 |
|---:|---:|---:|---:|---:|---|
|1,000 / 1,099,890 字符|471|461|267|37|1,001消息、500版本|
|5,000 / 5,503,890 字符|2,045|975|323|37|5,001消息、2,500版本|
|10,000 / 11,008,890 字符|6,066（单独反向复现 6,110）|1,992|292|37|10,001消息、5,000版本|

10k 单节点 get 由 20,038 降为 61；这**不等于只有 61 次全部数据库工作**：元数据索引仍遍历所选会话最多 50k 条 key，正文按 128 批次读并做 N 次必要指纹校验。全历史生成/重构路径仍有 O(N)，冷发送约 2 秒仍未达到“历史增长几乎不影响”的最终标准。

长正文采样中的 16ms 定时器最大间隔为 53.4/74.1/124.6ms，仍有主线程长任务，不能声称零卡顿或稳定 60fps。普通短文本完整路径读取也出现 37/210.6/422.7ms → 60.6/257.2/526.5ms 的上升；元数据 key-cursor 是安全与大正文成本的取舍，不能声称每个子项都变快。相同夹具首次本地追加从 40.2/210.8/479.3ms 降为 34.5/99.8/207.6ms。Token/Provider/model 不在此测量中，模型服务延迟未伪造。

## 恢复兼容性补充

扩展选择首次为 117 项：97 通过、20 失败。五项旧备份用例在原始 main 全部同样失败（旧 20 表、v8/native80 断言）；恢复 fixture 把实际 v9 的表声明为 v7，无法进入目标行为；另外旧 v6 回退入口拒绝了准确旧结构。三个代表性 restore/storage 基线用例也在 main 实跑失败，未声称逐个重跑所有 20 项。

修复只允许准确旧 v5/v6 的**隔离候选**加法升级，正式目标仍经原 strict schema 门禁，未知表/索引拒绝且版本和原记录保留。回退旧表先逐项核对旧摘要；新空表必须确认为空；贴纸新表必须与已核验的旧 themes 库确定性一致。审查中新增的 File 元数据反向用例先复现了浅对象比较的错误接纳，再改用真实备份 codec 行哈希；没有降低来源要求。篡改旧正文来源、派生图片或派生 File 元数据都不能覆盖当前库。一级记忆、角色、原始聊天、API Key 配置未做实际用户数据迁移。

中间 34/36 项针对性恢复复测、49 项新读链专项及串行性能测试均实际运行；这些与最终大选择重叠，**不再重复计入独立总数**。开发时的新 reader 曾出现 3 个编译错误，修复后才进入最终构建；被中止的实验与端口配置错误基线也不算通过。

## 仍然阻止完整验收的事项

1. 正文在 messages / variants / pathNodes 中只保留一份的迁移未完成。
2. 自动回收废弃分支/回复未完成；不能在未完成可达性分析时删除恢复快照或记忆仍引用的来源。
3. 11M 字符冷发送仍约 2 秒，全路径及 legacy 同时间组的成本不保证常量；短路径读取存在上述实测回退。
4. 既有 raw-history 提示约束测试仍失败；没有改记忆提示词来让性能 PR 变绿。
5. WebKit 和真实 iPhone Safari/PWA 未验证，内存峰值/电量/帧率没有可靠实测。

因此保持 Draft，不宣称本任务所有验收标准已经满足。


### 最后集成复测发现的问题（保留失败记录）

`b41288e` 的完整选择为 474 项：471 通过、3 失败。除既有 raw-history 文案外，10k 旧引用编辑/分支返回暴露了分页竞争；以上两个受控失败复现并修复后，13 项历史/引用/长正文压力复测全部通过，10k 全遍历约 49 秒，分支返回约 16 秒，未放宽原有 5 秒定位断言或 240 秒完整遍历上限。

另一次完整遍历在 240 秒时页面已返回桌面。原运行没有文档导航监控，**无法证明是 Vite、缓存或应用导航的哪一方造成**。新测试只读记录 DOMContentLoaded、主框架导航和 Vite full-reload 计数；两次压力复测未重现，没有通过禁用测试或隐藏页面错误来处理。最终整体运行是否出现重载见最终结果，不把单独复测成功当成已彻底解释这次异常。

扩展的私人记录背景测试曾在 reload 后仅等待 Phone.ready 就开 App，失败页面仍为桌面；改为等待 Spaces.booted 且非 transitioning 后再操作。只同步测试的真实启动前置条件，没有改私人记录业务或削弱图片解码/持久化断言。

最后运行代码为 `72515590a8cff37b5da700f155c5d15808f15cd7`（输入/索引机制与前述 b41288e 性能采样相同，另修分页协调）。最终统计不会将 13 项复测与完整选择重复累加。完整 `npm test` 的所有仓库用例没有运行，只运行本报告明确列出的受影响选择。

主线程、后台自动任务积压与用户真实数据库同时存在时的竞争，以及极端长图片字幕/单条多气泡，仍没有真机数据；公开的合成测量不能替代这些场景。


## 本轮提交与实际文件清单

- `e74036c`：composer 隔离、V3 引用快照、兼容读回和预览。
- `c4be125`：归档分支增量追加证明、引用页读取及旧测试同步。
- `b41288e`：大正文元数据索引读链、去除普通发送重复全读、旧副本兼容核验。
- `7251559`：分页排队、元数据刷新不丢引用、导航/来源护栏和启动前置条件复测。

以下为 f7194a8 之后的代码/测试/配置文件，之前分支的八次有效提交保留；报告和截图另列：

- `scripts/automation-build-policy.mjs`
- `scripts/test-reference-chat.mjs`
- `src/Chat.tsx`
- `src/ChatDraft.tsx`
- `src/ImageAttachments.tsx`
- `src/MessageUI.tsx`
- `src/backupFormat.ts`
- `src/backupZip.ts`
- `src/chatListPreview.ts`
- `src/chatService.ts`
- `src/chatTypes.ts`
- `src/imageAttachments.css`
- `src/importPlan.ts`
- `src/messageOperations.ts`
- `src/restoreData.ts`
- `src/restoreService.ts`
- `src/snapshotPreview.ts`
- `src/snapshotReferences.ts`
- `src/timelineReadCache.ts`
- `src/timelineValidation.ts`
- `src/timelines.ts`
- `src/useChatViewport.ts`
- `tests/branch-storage-probe.spec.ts`
- `tests/archived-append.spec.ts`
- `tests/automation-build-policy.test.mjs`
- `tests/backup-zip-stream-compat.spec.ts`
- `tests/backup-zip.spec.ts`
- `tests/backups.spec.ts`
- `tests/bubbles.spec.ts`
- `tests/chat-draft-isolation.spec.ts`
- `tests/chat-history-window.spec.ts`
- `tests/chat-large-body.spec.ts`
- `tests/chat-paging-coordination.spec.ts`
- `tests/chat-snapshot-metadata.spec.ts`
- `tests/chat.spec.ts`
- `tests/daily-reply-integrity.spec.ts`
- `tests/generation-tasks.spec.ts`
- `tests/image-send.spec.ts`
- `tests/keyboard-auto-reply.spec.ts`
- `tests/lore-trigger.spec.ts`
- `tests/performance-audit.spec.ts`
- `tests/performance-render.spec.ts`
- `tests/private-notes.spec.ts`
- `tests/reference-restore-schema.spec.ts`
- `tests/reference-snapshot.spec.ts`
- `tests/restore.spec.ts`
- `tests/snapshot-cost.spec.ts`
- `tests/story-depth.spec.ts`
- `tests/story-failure.spec.ts`
- `tests/story-guidance.spec.ts`
- `tests/story-output-budget.spec.ts`
- `tests/story-reading-pov.spec.ts`
- `tests/story-storage.spec.ts`
- `tests/theme-chat-acceptance.spec.ts`
- `tests/timelines.spec.ts`
- `vercel.json`

截图：[390px](../artifacts/reference-snapshot-390.png)、[430px](../artifacts/reference-snapshot-430.png)。均为 Chromium 模拟视口与 synthetic 数据，不是真机截图。


## 最终冻结代码运行结果（2026-11-28）

运行期间未修改源码，也未同时运行另一个浏览器套件。

| 命令/选择 | 通过 | 失败 | 退出码 |
|---|---:|---:|---:|
| `npm run typecheck` | — | 0 | 0 |
| `npm run build` | — | 0 | 0 |
| 去重主回归 476 项（`node scripts/test-reference-chat.mjs --reporter=list,json`） | 474 | 2 | 1 |
| 恢复/私人记录/生活引擎/剧本存储扩展 117 项 | 117 | 0 | 0 |
| 串行性能选择 17 项 | 17 | 0 | 0 |
| 大正文单次发送 3 项 | 3 | 0 | 0 |
| 加强后的三次连续发送 + 编辑/回退存储观察 6 项 | 6 | 0 | 0 |
| 单独带 trace 重复运行 txt/invalid 剧本用例 5 次 | 5 | 0 | 0 |
| Node hosting policy | 17 | 0 | 0 |
| WebKit 启动探测 | 0 | 1 | 1 |

以上含重复用例，不累加为独立通过总数。主回归与扩展选择合计 593 个不同用例：591 通过、2 失败；额外测量、反向复现和重跑分别报告。加强连续发送是在冻结运行代码上修改测试后运行，三项替换原单次发送观测，未额外算作不同业务验收。

两项失败：

1. 上述已在 main 独立复现的 raw-history 提示文案约束。不修改该提示词、不删除断言。
2. `tests/story-direct-play.spec.ts:14` 的 txt/invalid：重新生成后的 `expect.poll` 中，`page.evaluate` 报 `Execution context was destroyed, most likely because of a navigation`。随后完全相同的测试带 trace 连跑五次通过。原失败没有足够导航追踪，无法证明是应用缺陷还是开发服务器/浏览器环境；没有改 Story 生产逻辑或捕获并忽略异常，仍列未解决。

两项 10k 历史全遍历/引用编辑分支测试在本次完整运行均通过，没有检测到额外文档加载。前一轮遍历超时时页面返回桌面，缺乏追踪，原因也未证明；新增只读导航追踪用于后续获取证据，不冒充已修复该偶发问题。

### 最终测量（同运行代码，串行单样本）

普通短文本 1k/5k/10k 首屏分别 169/153/144ms；首屏 36 组，滚动挂载上限 60。56 字输入 Chat commit 数均为 0；归档后热追加分别 4.3/5.7/5.6ms，完整 message 行读取为 0。完整路径读取分别 57.5/318.3/531.5ms，仍有 O(N) 且部分场景慢于原基线。快照分别 339/341/341 bytes，单节点 get=1，写入 1.7/13.3/1.3ms。不能从这些单样本推导 iPhone 帧率或 p95。

| 消息数 / 约1100字符正文 | 首屏 ms | 连续三次本地保存 ms | 三次单节点 get | 原始数据 |
|---:|---:|---|---|---|
|1000|335|455 / 97 / 132|28 / 3 / 3|1003 消息、500 版本|
|5000|326|1996 / 156 / 96|24 / 3 / 3|5003 消息、2500 版本|
|10000|265|2003 / 2438 / 1915|63 / 39 / 39|10003 消息、5000 版本|

最终单次发送的独立样本 1k/5k/10k 为 516/2038/3037ms；完整双 worker 回归中 10k 为 4247ms，不能用更快串行结果代表负载下稳定耗时。长正文连续保存的数据如上，不能宣称已消除规模增长成本；16ms 定时器最大间隔仅是主线程停顿线索，不是输入延迟或 FPS。

### 早期编辑/回退的存储观察

这是只读计数与合成库操作测试，明确不代表 canonical 单份正文或 GC 已完成。

| 消息数 | 编辑前节点 | 编辑/回退后节点 | 中间未修改消息的节点副本 | 编辑 ms | 回退 ms | 原文恢复 |
|---:|---:|---:|---:|---:|---:|---|
|1000|1000|1001|1|451.5|361.6|完整|
|5000|5000|5001|1|2077.1|1852.5|完整|
|10000|10000|10001|1|3642.3|3541|完整|

本夹具未复制全部下游节点，但 messages、variants、pathNodes 的现有正文投影仍并存；废弃版本/节点也未回收。10k 的编辑与回退仍数秒，必须继续处理，不能据此合并为“彻底完成”的版本。

### 工作区保护及后续验收

原 `/workspace/claudia-phone` 的 tracked diff 与 porcelain 状态哈希始终分别为 `92af36ad6a5e8451ac2b136ccef87eaf08046cbdcedec20df8008e25be050a50`、`78341e682ec358fe8fa2167432e65ef91f2f132fff86f3a1b242cd7fd5047569`。未清理/覆盖其他成果。基线试验只在自己的 detached worktree，试验性 tracked harness 已恢复其 HEAD。

未调用付费 API，未操作用户真实数据库；未修改 main、密钥、域名或 Production。保持 Draft。下一阶段必须完成 canonical-body 兼容迁移与可达性 GC、降低大正文冷保存/历史编辑成本，并查清两项回归失败；真实 iPhone Safari/PWA 的键盘、滚动、合成层与复杂自定义 CSS 仍需实机验收。

# PR #82 第二轮审计、修复和本地验收

## 工作现场和范围

在 `feat/raw-history-recall-81` 继续，审查基线为 PR 原提交 `e9f447858243f46e2a828aaf0843aef8ed805660`。远端main为67314de，未合入/修改/推送main。PR评论仅有部署机器人信息，无人工review/inline意见。保留原工作树137项修改及本功能worktree原有截图/依赖链接，未清理。

所有实验是独立数据库、合成记录、Mock API。本轮没有收费模型调用，也没有手动部署。首次审核的主分支基线数据仍在原审计报告；本报告以PR原提交作直接前后对照，不能混用两次基线。

## 已确认问题与修复

1. **完整历史重复复制和无效处理**：`timelines.ts / timelineReadCache.ts` 在热读、事务缓存、提交缓存和消息投影之间反复structuredClone全路径。`chatContext.ts`还对全部历史做visibleMessage，`memoryContext.ts`和磁铁入口在没有摘要/磁铁/二级记忆时也建全量原文索引。改为私有递归冻结快照，已审查的内部读取显式复用；默认公共读取仍返回可修改的分批副本。只处理请求真正要发送的近期可见消息；空记忆分支提前跳过昂贵映射，所有校验仍保留。
2. **World核心记忆引发串行IDB重读**：`memoryValidation.ts`每次为检查记忆锚点从头逐节点get整条路径。`memorySummaryValidation.ts`长路径也存在逐节点回退。现场有一个手动核心事实的30k World基准，PR原版热上下文达10348.9ms。实库调用可传入同事务、同会话的已验证只读路径读取器，复用指纹/断链/归属校验；临时数据库与备份验证不传该参数，仍使用原独立数据库校验，绝不借用正式库缓存。
3. **分支回到长父路径的查询爆炸**：缓存分支不包含目标head时，`nodesForHead`会逐节点走完整条旧分支才找到共同祖先。现在最多单步128个新tip，之后使用有界分页图读取。测试同时验证查询次数上限和完整正文，不靠放宽超时证明性能。
4. **并发冷索引污染**：两个或三个召回任务可同时向同一部分构建的索引追加相同位置，破坏processed/boundary与热缓存判定。先修正测试准备阶段错误，再在原PR实际重现cacheHit=false；本轮以单个索引的在途Promise序列化写入，不发额外请求。
5. **经期误召回**：health主题含单字疼/痛，把牙痛、工作痛点关联到旧经期。收紧关联词；保留肚子/腹痛/不舒服等明确桥接，新增两种反向用例。
6. **否定误判不确定**：不是玩笑、没有开玩笑、不可能等包含不确定关键词，原来整条排除。只移除这些明确否定词的误触发，原文一字不改；真正假设/玩笑/条件继续保守处理。
7. **旧立场压过新立场**：近期完整聊天已有明确新态度，旧相反态度仍作为补充资料注入。对可靠识别的同一用户明确表态，优先新来源并抑制相反旧表态；第三方转述/假设不作为立场变化。最近30条也独立参与覆盖判定，即使历史索引到达容量上限。没有改写旧消息，也没有把尝试/计划当作完成事件。本轮进一步用正反测试排除“想了解婚姻”的咨询、自问句和转述，支持“我想结婚了/我愿意结婚”等明确表态；较早“不婚”也可检索，不以狭窄的“不想”字面为唯一依据。
8. **失效来源仅凭快照继续注入**：在原PR中删除旧原始行但保留不可变节点，直接重建上下文仍会引用已不存在的原话。本轮对最多4条拟注入证据，在一个只读事务中重读消息、版本、节点与当前owner/head；核对角色、时间、内容、node指纹证明与分支。广播延迟、直接删除/改写也不能仅凭旧缓存继续引用。单条失效只过滤该条，不追加模型调用。
9. **活跃聊天DEV属性比较**：CPU采样显示React开发模式addObjectDiffToProperties消耗数秒，原因是把30k完整数组传给每个可见气泡；已有messageIndex却仍重复传历史，完整conversation又携带整份记忆状态。现在只传引用索引与稳定的id/mode/epoch，预览仍兼容messages回退；气泡视觉、分段、长按、编辑、引用跳转和版本功能不删。开发模式性能不得冒充Production或真机测量。
10. **本轮新增共享快照的防污染保护**：递归冻结内部对象/数组；默认API返回分批克隆。相同正文的不同timeline分别保留来源证明，不能相互改写WeakMap元数据。新增可变副本/只读快照、同正文时间线测试。此项是新共享路径的工程防护，不冒称原PR已存在同样共享缺陷。LRU淘汰/全量替换还会立即使持有的旧前缀证明失效，阻止在途任务继续信任。

## 响应性和预算

`chatCooperative.ts`在约6ms CPU时间片后把执行权交回任务队列，兼容MessageChannel缺失时setTimeout降级；仅在已有Dexie事务中用waitFor保活。SHA按组保活，不为每个历史节点独立挂keepalive；没有修改指纹序列化格式。没有scrollTo、样式偏移、布局高度或主题改动。

仍然保留近期约30条完整聊天（受既有24000字符预算约束）。原始召回最多4条、96个有界候选，块成本≤3000 UTF-8字节代理且受系统剩余字符预算限制，不重复注入近期实际已发送ID，不改变max_tokens/Provider。UTF-8字节是保守代理，不是准确模型Tokenizer；没有新增无限历史窗口。

冷建索引和全路径验证仍是O(N)，冷图读取、索引存储/GC与分支投影也仍有成本。热上下文不再重复深复制整条已验证路径，但新head构建数组/索引、UI窗口布局、默认公共可变API及复杂已存在摘要仍可能有O(N)工作，不宣称全管线O(1)。多窗口/无SW继续保守验证，不为提速牺牲来源。

## 性能结果

以下表格最终由同一驱动实际输出填充。基线与本轮均Chromium iPhone配置、Vite开发服务、隔离IndexedDB、相同合成消息、Mock回复；不是iPhone Safari实测，也不是线上Production耗时。单次实验含冷值与三次热中位数，不能编成p95或跨设备保证。

### 不打开会话的Daily请求基准（毫秒）

|消息数|冷构建 前→后|三次热构建中位数 前→后|模拟发送并保存 前→后|本轮首次追加|
|---:|---:|---:|---:|---:|
|1000|168.4 → 95.4|27.8 → 7.6|70.1 → 32.7|38.3|
|10000|1187.2 → 790.3|195.9 → 5.8|377.4 → 36.0|486.2|
|30000|4444.4 → 2743.2|620.5 → 8.1|1263.1 → 55.0|1995.8|

三次热请求的历史SHA仍为0，正常模拟发送仅处理2个新增消息；每个规模仅1次模拟Provider调用且实际保存N+3条。新增最终来源核对限4条，不重新扫描正文。

### 活跃UI / World核心记忆响应性驱动（毫秒）

|模式/消息数|冷构建 前→后|热请求 前→后|三次连续模拟发送 前→后|本轮冷阶段最大计时器间隔|
|---|---:|---:|---|---:|
|daily/1000|82.9 → 39.4|86.2 → 116.7|233.4/372.1/313.5 → 160.0/198.6/150.8|24.6|
|daily/10000|532.5 → 240.5|511.7 → 113.9|1358.7/891.4/1157.6 → 661.6/237.9/240.0|24.9|
|daily/30000|1562.9 → 558.8|1856.5 → 81.6|3925.9/2801.1/2629.0 → 2127.4/259.7/233.5|145.8|
|world/1000|693.1 → 122.0|465.9 → 20.0|412.8/487.2/388.8 → 125.8/70.4/68.5|32.1|
|world/10000|4807.4 → 786.4|3044.2 → 27.9|3830.7/3482.3/3130.1 → 575.4/75.1/64.0|63.9|
|world/30000|26109.0 → 2707.7|10348.9 → 153.1|12110.7/10464.3/10475.2 → 2113.0/118.4/127.3|133.3|

此驱动Daily先打开实际聊天UI（冷节点加载已包含在进入耗时中，表内cold指原始索引仍冷）；World设置核心事实后刷新再测完整冷上下文，两行冷值不能直接互比。Daily从桌面进入并填入草稿：1000条473→517ms，10000条1648→992ms，30000条3509→2568ms。1k活跃UI的个别热指标并未改善，单次样本有GC/渲染噪声，不声称所有指标都加速。

### 实际构建过程中输入

额外两项测试用计数探针确认至少500条原文已进入索引且构建尚未完成，再对真正聊天textarea输入中文；不是构建结束后才测试输入。390px输入69ms、430px输入79ms，草稿/焦点保留，召回成功，无横向溢出，API调用0。探针只在测试中安装并finally恢复，不进入产品；截图位于执行环境`/tmp/recall82-input-390.png`、`/tmp/recall82-input-430.png`。这仍非真实iPhone键盘/候选栏测量。

连续发送基准的首发更慢：首次需要建立严格的历史投影一致性证明，后续才使用增量追加。记录并保留该成本，没有把第二次发送冒充首次发送。Daily可见聊天有UI渲染开销，与不打开聊天的纯上下文基准分别列出。World基准含手动核心记忆；刷新后再测冷上下文，避免设置阶段缓存冒充冷读。30k Daily连续发送阶段启用同样CDP采样，存在采样开销。

## 实际验证

- 最终TypeScript：退出0；Production build：退出0（保留约1.48MB主bundle警告）。
- 最终组合回归：**464 passed, 0 failed, 0 skipped**，退出0。含完整聊天/Story脚本文件、53项原始召回/性能/输入/第二轮专项、键盘自动回复、PWA/视口/图片，以及受影响的记忆、时间线、备份恢复。
- 本轮单独完整聊天脚本曾执行：284 passed，退出0。它已被最终组合覆盖，不额外累加。
- 完整记忆/备份命令 `npm run test:memory-regression -- --trace=retain-on-failure`：**180 passed, 46 failed, 0 skipped**，退出1。并非全绿。
- 把上述46个失败原样放回原PR提交e9f4478再跑：**46 failed**，退出1；逐项比较均为同一断言位置、同一错误、同一Expected/Received，没有把测试环境或偶发超时当作代码回归。
- 两个主要回归组有60项重叠，去重后**630个不同用例，584通过、46失败**。不累加开发中的重复运行、基线失败复跑或前面的284/44项。
- 本轮完整记忆组在核心性能/来源修复后执行；末轮收紧立场与缓存过期后，其相关scope、并发、上下文、旧备份/ZIP用例又随464组合复验。没有修改总结生成代码来抹平既有失败。
- 未执行整个仓库全部npm test；未测试真实收费模型、真实iPhone。没有重跑/手动触发GitHub Actions。

最终464组合的可复现命令（全部文件一次收集，避免重复计数）：

```sh
npx playwright test \
  tests/heart-voice.spec.ts \
  tests/chat-snapshot-metadata.spec.ts \
  tests/story-writing-status.spec.ts \
  tests/story-directives.spec.ts \
  tests/story-guidance.spec.ts \
  tests/story-reading-pov.spec.ts \
  tests/story-depth.spec.ts \
  tests/daily-reply-integrity.spec.ts \
  tests/bubbles.spec.ts \
  tests/memory-integrity.spec.ts \
  tests/chat-context-regression.spec.ts \
  tests/request-diagnostics.spec.ts \
  tests/memory-context.spec.ts \
  tests/chat.spec.ts \
  tests/lore-trigger.spec.ts \
  tests/timelines.spec.ts \
  tests/story-response.spec.ts \
  tests/generation-tasks.spec.ts \
  tests/story-output-budget.spec.ts \
  tests/story-direct-play.spec.ts \
  tests/story-turn-recovery.spec.ts \
  tests/story-failure.spec.ts \
  tests/story-operations.spec.ts \
  tests/wizard-document-safety.spec.ts \
  tests/chat-history-window.spec.ts \
  tests/presentation-assets.spec.ts \
  tests/raw-history-recall.spec.ts \
  tests/raw-history-round-two.spec.ts \
  tests/raw-history-late-review.spec.ts \
  tests/raw-history-performance.spec.ts \
  tests/raw-history-responsiveness.spec.ts \
  tests/raw-history-input.spec.ts \
  tests/keyboard-auto-reply.spec.ts \
  tests/pwa-viewport.spec.ts \
  tests/world-input-viewport.spec.ts \
  tests/image-send.spec.ts \
  tests/memory-store.spec.ts \
  tests/memory-source-provenance.spec.ts \
  tests/memory-v2-compatibility.spec.ts \
  tests/memory-v2-backup.spec.ts \
  tests/memory-v2-concurrency.spec.ts \
  tests/backup-zip.spec.ts \
  tests/backup-merge.spec.ts \
  tests/restore.spec.ts \
  --workers=1 --trace=retain-on-failure
```

全量记忆失败不能都称为“测试过期”。至少存在以下实质风险：

- `memory-loop.spec.ts:83` 两个数字反转/改值用例期望失败，原PR与本轮均返回succeeded。
- `memorySummary.ts:85–95` 会按单API容量缩小选定组，40轮用例执行后仍剩17轮；旧验收要求整组推进，现有行为/契约需要明确修复。
- `memorySummaryFormat.ts:33–49` 的现用parseSimpleSummary主要做结构/content/type筛选，不再运行旧证据/数字真实性路径；旧回归仍要求这些保护。不能在原始召回PR中悄悄改回整个已合并#80提取策略。
- 一级回执/磁铁返回、失败调度及20轮UI还有既有失败。原始召回独立工作不等于它们已修复；原始召回不更新已总结轮数或消除API拦截。

全部原始日志/trace在执行环境`/tmp/recall82-*.log`、测试test-results内；来源均为合成数据。以下保留失败文件及用例清单，未删除/跳过任何失败：

|失败文件|用例数|原PR复现|
|---|---:|---|
|`tests/memory-loop.spec.ts`|21|同断言、Expected/Received一致|
|`tests/memory-magnet-concurrency.spec.ts`|1|同断言、Expected/Received一致|
|`tests/memory-magnet-outgoing-request.spec.ts`|2|同断言、Expected/Received一致|
|`tests/memory-summary-format.spec.ts`|8|同断言、Expected/Received一致|
|`tests/memory-summary-quality.spec.ts`|4|同断言、Expected/Received一致|
|`tests/memory-summary-receipt-return.spec.ts`|1|同断言、Expected/Received一致|
|`tests/memory-summary-scheduler.spec.ts`|2|同断言、Expected/Received一致|
|`tests/memory-summary.spec.ts`|6|同断言、Expected/Received一致|
|`tests/memory-v2-management.spec.ts`|1|同断言、Expected/Received一致|

<details>
<summary>46个失败用例及实际断言位置</summary>

- `tests/memory-loop.spec.ts:11:407` — 缺少非关键质量元数据仍能核对真实原文、保存记忆并推进40轮（原PR同源）
- `tests/memory-loop.spec.ts:16:207` — 同批格式兼容：facts根、嵌套引用；错误候选不连带丢弃合格候选（原PR同源）
- `tests/memory-loop.spec.ts:21:207` — 中文无证据字段可从真实来源恢复；不反转否定、不把计划当成事实（原PR同源）
- `tests/memory-loop.spec.ts:39:32` — 实际IndexedDB积压100轮：手动处理、回执去重、刷新恢复（原PR同源）
- `tests/memory-loop.spec.ts:39:32` — 实际IndexedDB积压478轮：手动处理、回执去重、刷新恢复（原PR同源）
- `tests/memory-loop.spec.ts:43:294` — 合法空候选与全格式错误分开：空结果提交回执，错误不推进（原PR同源）
- `tests/memory-loop.spec.ts:50:761` — 数据库提交异常整批回滚，已完成检查点可零API恢复 新版（原PR同源）
- `tests/memory-loop.spec.ts:50:761` — 数据库提交异常整批回滚，已完成检查点可零API恢复 旧统计缺失（原PR同源）
- `tests/memory-loop.spec.ts:54:471` — 协议兼容真实入口 openai-compatible（原PR同源）
- `tests/memory-loop.spec.ts:54:471` — 协议兼容真实入口 gemini（原PR同源）
- `tests/memory-loop.spec.ts:59:223` — 一级成功而核心提炼失败仍保留五组回执，失败不自动再次收费（原PR同源）
- `tests/memory-loop.spec.ts:63:530` — 100轮配置进入真实请求：完整200条原文，一个逻辑批次（原PR同源）
- `tests/memory-loop.spec.ts:67:92` — 超长消息跨分片不丢失原文前置条件，不能将条件习惯当作既成事实（原PR同源）
- `tests/memory-loop.spec.ts:71:425` — 引用仅有标点差异时保存真实原文引文，而不是整批失败（原PR同源）
- `tests/memory-loop.spec.ts:75:376` — 部分真实部分伪造引用不能组合出新事实，其他合格候选仍保存（原PR同源）
- `tests/memory-loop.spec.ts:80:453` — 请求后的容量失败不能静默自动恢复，手动恢复复用已付费检查点（原PR同源）
- `tests/memory-loop.spec.ts:84:700` — 错误数字事实不能写入或推进：-100→100（原PR同源）
- `tests/memory-loop.spec.ts:84:700` — 错误数字事实不能写入或推进：100→200（原PR同源）
- `tests/memory-loop.spec.ts:91:577` — 二级提炼独立失败可见且不锁住一级：timeout（原PR同源）
- `tests/memory-loop.spec.ts:91:18` — 二级提炼独立失败可见且不锁住一级：configuration（原PR同源）
- `tests/memory-loop.spec.ts:95:629` — 一级请求异常不误报路径失效、不推进、不自动收费：timeout（原PR同源）
- `tests/memory-magnet-concurrency.spec.ts:41:17` — interrupted claim never auto-retries; explicit recovery requires failed status（原PR同源）
- `tests/memory-magnet-outgoing-request.spec.ts:39:28` — message-level recall reaches actual model request and removing tag stops return: openai-compatible（原PR同源）
- `tests/memory-magnet-outgoing-request.spec.ts:39:28` — message-level recall reaches actual model request and removing tag stops return: gemini（原PR同源）
- `tests/memory-summary-format.spec.ts:7:94` — 复现旧解析器拒绝说明包装，兼容完整JSON/围栏但保持严格逐条校验（原PR同源）
- `tests/memory-summary-format.spec.ts:8:759` — 总结专用JSON参数及实际响应包装兼容 openai-compatible（原PR同源）
- `tests/memory-summary-format.spec.ts:8:759` — 总结专用JSON参数及实际响应包装兼容 gemini（原PR同源）
- `tests/memory-summary-format.spec.ts:9:553` — API明确截断即使JSON完整也不写入、不推进进度 openai-compatible（原PR同源）
- `tests/memory-summary-format.spec.ts:9:553` — API明确截断即使JSON完整也不写入、不推进进度 gemini（原PR同源）
- `tests/memory-summary-format.spec.ts:10:409` — 58轮格式失败可见诊断、无私密原文，主动重试后只推进本次区间（原PR同源）
- `tests/memory-summary-format.spec.ts:11:411` — 58轮输入超过100分片时零请求、准确报告输入阶段，不误报格式（原PR同源）
- `tests/memory-summary-format.spec.ts:12:345` — 接口拒绝结构化参数无自动回退，非法诊断字段拒绝进入备份（原PR同源）
- `tests/memory-summary-quality.spec.ts:11:1051` — 合法空结果正常推进；普通事件筛掉后零条也不反复请求 openai-compatible（原PR同源）
- `tests/memory-summary-quality.spec.ts:11:1051` — 合法空结果正常推进；普通事件筛掉后零条也不反复请求 gemini（原PR同源）
- `tests/memory-summary-quality.spec.ts:12:621` — API异常、格式错误、截断和缺失质量元数据不能伪装成空成功（原PR同源）
- `tests/memory-summary-quality.spec.ts:15:635` — 重要关系变化实际写入；同角色世界和其他角色不能借用这段证据（原PR同源）
- `tests/memory-summary-receipt-return.spec.ts:33:24` — verified first-pass summary reaches prompt; edited source invalidates it（原PR同源）
- `tests/memory-summary-scheduler.spec.ts:52:156` — automatic summary: provider 503 ends immediately, then waits another interval（原PR同源）
- `tests/memory-summary-scheduler.spec.ts:81:156` — automatic summary: authentication error stops after one attempt and defers（原PR同源）
- `tests/memory-summary.spec.ts:16:773` — 第40轮正常回复后异步总结、默认关闭、一次请求、重新生成不加轮 openai-compatible（原PR同源）
- `tests/memory-summary.spec.ts:16:773` — 第40轮正常回复后异步总结、默认关闭、一次请求、重新生成不加轮 gemini（原PR同源）
- `tests/memory-summary.spec.ts:21:1225` — Provider失败、空结果和非法操作不写入，不自动重试，手动重试安全成功（原PR同源）
- `tests/memory-summary.spec.ts:28:1073` — 总结在途不阻塞正常回复，只覆盖已捕获区间（原PR同源）
- `tests/memory-summary.spec.ts:29:1234` — 超过100分片的输入拒绝调用、结构化类别校验、挂起租约不自动重试（原PR同源）
- `tests/memory-summary.spec.ts:38:159` — 长轮次完整分片，全部成功后一次提交，原文不丢失且不自动重复收费（原PR同源）
- `tests/memory-v2-management.spec.ts:9:1553` — 20轮自动总结真实路径更新短期UI且只调用一次，手动核心原样保护（原PR同源）

</details>


基线5项失败（误召回、否定漏召回、旧立场、并发冷索引、删除原始来源）均实际执行后再修复。初次新增并发用例初始化错误和非严格page.evaluate中expect赋值抛异常的测试假设已改正；不把这些测试准备问题算成产品缺陷。原先“新旧态度都必须出现且新排前”的断言，按本次“新立场覆盖旧立场”要求收紧为新原话存在、相反旧原话不再注入，并非删除断言。

## 数据兼容性和剩余风险

- 没有升级Dexie、改表/索引/备份格式、删除记录、重置待总结进度。易失来源证明和缓存不写入备份。默认公共消息API保留可修改副本语义。
- 没有改变总结生成提示词、API配置/密钥、请求参数、人物资料、世界书、Story、其他游戏、聊天CSS或导航/键盘布局。记忆校验器只增加同库受验证读取器的可选参数，恢复库继续走原路径。
- 本地主题/态度规则是保守启发式，不能证明所有语义同义表达均正确。混合事实与条件/假设的消息仍可能被保守过滤；资料进入模型不代表模型百分之百自然使用。没有调用真实付费模型验证语义质量。
- 索引仍限2个会话、每个50000消息/8388608正文UTF-16代码单元，超限标记incomplete而不删原文。不是heap字节上限；真实iPhone内存峰值没有测量。
- 冷启动、首次完整投影、复杂/巨大单条消息、活跃UI、多个窗口仍可能卡顿；浏览器计时器/帧回调有调度与GC噪声，不是可靠的硬实时指标。
- 390/430px为浏览器模拟。没有真正iPhone Safari/PWA、中文候选栏、锁屏恢复、低内存或后台挂起验收；不得宣称真机已通过。

PR保持Draft，不合并main、不部署Production。是否达到合并条件以最终测试和下方未解决项为准，不能用提交/构建代替验收。

## 实际修改文件

- `src/Chat.tsx`
- `src/MessageUI.tsx`
- `src/chatContext.ts`
- `src/chatService.ts`
- `src/memoryContext.ts`
- `src/memoryMagnetMessages.ts`
- `src/memoryStore.ts`
- `src/memorySummaryValidation.ts`
- `src/memoryValidation.ts`
- `src/messagePath.ts`
- `src/pathProvenance.ts`
- `src/rawHistoryRecall.ts`
- `src/rawHistoryTerms.ts`
- `src/timelineReadCache.ts`
- `src/timelines.ts`
- `src/chatCooperative.ts`
- `tests/raw-history-performance.spec.ts`
- `tests/raw-history-recall.spec.ts`
- `tests/raw-history-responsiveness.spec.ts`
- `tests/raw-history-round-two.spec.ts`
- `tests/raw-history-late-review.spec.ts`
- `tests/raw-history-input.spec.ts`
- `tests/rawHistoryPerformanceFixture.ts`
- `tests/rawHistoryReviewFixture.ts`
- `docs/raw-history-recall-review-82.md`

## 合并结论

**当前不具备“全项目全绿、已在真实iPhone验收”的合并条件。** 本轮原始召回和受影响模块最终464项通过，但46个既有总结失败/契约冲突及真实设备性能仍需解决或验收。保留Draft，不能把“无新增失败”当成“现有记忆系统没有问题”。特别优先处理数字/来源事实真实性和总结进度，再处理调度/契约与真实PWA性能。所有开发保留在本PR分支，不改main/Production。

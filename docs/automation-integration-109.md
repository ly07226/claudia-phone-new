# PR #109：main 同步与自动任务集成验收

日期：2026-11-25。工作分支：`feature/dual-automation-api`，关联 Issue #110。**保持 Draft；未反向合并 main，未执行部署。**

## 结论与验证边界

最终运行代码为 `0f221acb5a264be5d4ce62f40035a124bff52330`：TypeScript、Production build、最终集成 **471 通过 / 0 失败 / 0 跳过**。471 中含完整的 **284 项聊天回归和 187 项受影响专项**，文件去重后在同一次运行执行。

修复过程中的完整全项目扫描对应 `77e04f1`：**1352 通过 / 153 失败 / 0 跳过，退出码 1**。此后进行了请求优先级/FIFO 修复和测试同步，并完整重跑受影响集成；**没有把此前全量结果冒充最终代码的全项目通过，也没有把重复运行累加为独立通过数。** 最终代码新增了 4 个优先级用例，未再完成包含这 4 项的全项目 1509 项扫描。

因此：Git 冲突可解决，功能专项可评审；**尚不能声称已达到全项目正式合并条件**。全项目失败仍需进一步闭环，详见[逐项清单](automation-integration-109-failures.md)。真实付费 Provider 与真实 iPhone Safari/PWA 尚未验证。

## main → 功能分支同步

- 同步 main：`13e943145ddc2bde9745dcd6ad425c124a06a961`（PR #108 QQ 修复）。
- 合并提交：`b1cbfcddf0d723ee3b6f33ae3118099718f92ca6`；方向仅 main → feature。
- `src/main.tsx`：保留 QQ 上下文观察、重新打开/前台同步及原有清理逻辑，同时保留全部自动任务入口。
- `vercel.json`：合并保留 4 个功能分支的部署禁用项，没有覆盖 QQ 路由、Service Worker 缓存头或其他配置。
- QQ 前端生成/同步、Supabase 函数、SQL、worker 与最新 main 无功能差异；仅同步测试等待真实并发回填完成，仍要求全部 3103 条、正确角色/内容及去重。
- 未修改 `src/store.ts`，未增加 Dexie 版本或执行用户数据迁移。

## 已确认的缺陷、修复与证据

| 位置 | 触发与影响 | 修复与复现 |
|---|---|---|
| `src/main.tsx:1036`、`AutomationSchedulers.tsx:11`、`automationSchedulerLease.ts:5` | 模块级记忆定时器无对称清理；安装器重复调用可生成多个 runtime；绑定 App 视图的任务随路由卸载 | 全局组件置于 phone router 之外；ready 所有权；同一 tab 引用计数、幂等释放、最后 owner 清理。最初 4 项生命周期反向测试均失败，修复后通过。页面切换不重复初始化。 |
| `memorySummaryScheduler.ts:37`、`characterLifeScheduler.ts:40`、`privateNotesScheduler.ts:44` | 扫描期间再次唤醒可能丢失，重复监听/轮询；queued 工作脱离原 owner | 合并唤醒，保留轮换游标；online/pageshow/visibility 唤醒及对称卸载；不重建调度架构。 |
| `memorySummary.ts:159,293`、`memoryCoreBuilder.ts`、`dailyDigest.ts:124` 及各生成入口 | 任务已排队后停止 owner，原 preflight/延迟恢复/积压 tail 仍可能开始新 HTTP；简单在提交时检查停止又会丢掉已付费有效片段 | 运行时 admitted guard 传到请求前，并贯穿冷却、下一组、核心和自然日 tail。纯来源校验与“能否开始新请求”分开。未发出的请求阻止；已收到且来源有效的片段/回执正常提交，后续不再启动。 |
| `summaryLock.ts`、`proactiveMessages.ts:125` | 普通主动消息占据角色锁时，独立游戏事件直接失败；游戏/force 后又可能被闲置扫描立刻追加一次请求 | 只有有独立收据的游戏事件有限等待锁（90 秒），普通扫描/并发 force 仍非阻塞去重。所有实际尝试记下有限时间戳，避免永久 anchor 也避免同周期额外调用。Web Locks/IndexedDB 两种失败基线已复现；有限等待、FIFO、收据和真实两条保存消息验证通过。 |
| `proactiveMessages.ts:130` 及扫描 | 删除好友保留自动开关，deadline 仍返回历史时间：实测 `1800001`，导致 max(1000, past-now) 每秒空转 | 无效/未添加/已删除好友不参与 deadline 或历史读取；不删除设置。live-query 读取好友记录，恢复好友可重新唤醒。无效角色及 World 历史读取为 0，正常角色仍成功生成并保留全部原文。 |
| `proactiveMessages.ts:69`、提交事务 | 排队后角色删除仍会请求；角色替换后旧上下文可继续请求；付费响应途中替换角色，旧回复可能写入替换后的会话 | 请求前重验角色、世界、模式、好友与世界关联；提交再验捕获的角色/世界/模式，旧错误不写到替换角色。3 项故障在修复前实测失败；8 项 deadline/身份边界回归通过。 |
| `automationRequests.ts:32`、实际 admission | 来源校验 await 期间普通聊天/隐藏/离线发生变化，发送前未复查；旧 A 队首阻塞独立 B；全局锁瞬态竞争可使同资源 A2 越过 A1 | 请求前再次检查 foreground/hidden/online/backup；有界扫描 ready 资源，阻塞资源保留原相对顺序；同资源旧请求优先。无新的 ID/Provider 系统。原生 HTTP 探针得到 `duringPreflight=1, B等待=[], 顺序=[a,b]`，修复后 4 项通过；并发 10 轮 × 4 项 = 40 次重复执行通过，未算为 40 个独立用例。 |
| `AutomationApiPanel.tsx`、现有 dedicated 配置 | UI 切换与已领取任务的 API 快照语义不清 | 明确已开始任务保留快照、新任务用新配置；实际 OpenAI A → 自定义 Gemini B → A 的 HTTP 路径、头、模型、预算和保存均验证。禁用 B 保留其 key 和副本，不改原聊天绑定。 |

### 调度所有权与范围

记忆一级/五组核心/自然日、朋友圈自动发布和角色评论、主动普通/force/game、生活推进、日记/备忘/独立梦境复用同一请求 admission。正常聊天不经过自动队列，不取消正常聊天。仍有的用户显式手动操作（例如角色手动发朋友圈、私人记录评论回复）保留原 foreground 语义；没有偷偷转成后台任务。

记忆、生活和私人记录安装器全局单 runtime；朋友圈、主动和自然日组件全局常驻。日记与梦境串行领取同一角色 owner，各自独立进度；梦境默认关闭。日历提示在小手机之外隐藏，扫描仍可继续。运行只保证前台及返回前台恢复；不承诺关闭 iOS PWA 后前端持续运行，云端执行不在 Issue #110 范围。

## 1185 轮使用真实业务执行路径

`tests/automation-audit.spec.ts:65` 初始化 2370 条实际结构消息和真实配置保存函数，然后 **page.reload → 全局组件 → 调度器 → tryAutoSummary → 请求队列 → Provider/native HTTP → 解析/来源核验 → IndexedDB → 回执 → 下一组**。没有直接调用 tryAutoSummary 来替代根入口，没有手写“总结成功”状态。只模拟 HTTP 响应。

断言真实 POST 路径、Authorization（合成值）、模型、输出上限，逐条核对实际送出的原文索引 0..1099、全部 1100 条 assistant 来源 ID、11 组 100 轮回执以及软删除核心不重复生成。

单 worker 最终实测：6250 ms，66 个一级请求 + 2 个核心请求；66 条长期 + 2 条核心；待总结 85（低于当前 100 轮阈值）；原始消息仍 2370 条。不是付费模型速度、质量或真实 iPhone 完成时间的证明。

## 性能数据

最终代码、单 worker、本地 Chromium、合成数据，对比同一条“最新用户时间查询”的旧全历史路径与现有尾部/索引路径：

| 消息数 | 旧全路径 | 新尾部/索引 |
|---:|---:|---:|
| 1,000 | 21.4 ms | 0.9 ms |
| 10,000 | 197.4 ms | 1.2 ms |
| 30,000 | 493.9 ms | 1.4 ms |

这不是整个聊天进入/输入延迟或 iPhone 帧率。无效角色不读历史，开启自动任务也不因输入每个字重新挂载。记忆输入仍需受预算和来源校验约束，不能承诺任意规模零成本。并发全量扫描中的耗时另有负载影响，不拿它冒充受控性能数据。

## API、恢复、数据安全

- Provider 超时从实际 HTTP admission 开始计时，等待普通聊天不消耗响应时间。
- 成功分片保留；一级与核心失败独立；来源变化不提交，回执/进度仅在有效事务成功后推进；失败不自动关闭开关。
- 有限重试/下一周期恢复可能再计费。认证、额度等需修正配置，未知远端结果不能保证“从未计费”；不承诺 exactly-once 远端账单。
- 已经发送的有效付费请求不会被后来开始的普通聊天强制取消。资源身份依据 endpoint/key；不同 key 仍共享服务商账户限额的情况无法推断。
- 继续使用 `dedicatedSummaryApi` 配置键，字段增量可选；不清空聊天、记忆、私人记录、用户 key 或检查点。runtime lease 继续不进入备份。
- 原文分片/来源验证、分支隔离、手动核心保护、ZIP/加密及同意后的凭据选项保留。所有读写验收在隔离的合成数据库进行，没有操作用户真实数据库。

## 实际验证结果

| 命令/组 | 结果 | 退出码/边界 |
|---|---|---|
| `npm ci` | 完成 | 0，依赖未升级 |
| `npm run typecheck` | 通过 | 0，最终运行代码 |
| `npm run build` | 通过 | 0；保留既有大 chunk 警告 |
| 全项目 `npm test -- --workers=4 --reporter=list,json` | 1352 通过 / 153 失败 / 0 跳过 | 1，代码 77e；不是当前头的全量清零 |
| 最终完整聊天 + 受影响集成 | **471 通过 / 0 失败 / 0 跳过** | 0，代码 0f；284 + 187，同一去重运行 |
| 构建策略/QQ context/Edge/旧故障 Node 组 | 32 通过 / 0 失败 | 0 |
| 本地 PostgreSQL QQ 数据库 | 8 通过 / 0 失败 | 0；真实 SQL，合成数据，无生产连接 |
| 重点优先级、超时及390/430 UI | 7 通过 / 0 失败 | 0，471 中的子集 |
| 优先级压力复测 | 10 轮 × 4 项，40 次通过 | 0；不是 40 个独立用例 |
| 最终独立性能复测 | 4 通过 / 0 失败 | 0；471 中的子集 |

最终集成实际完整命令（文件集合去重，包含 package.json 的 test:chat-regression 全部文件）：

```sh
npx playwright test tests/heart-voice.spec.ts tests/chat-snapshot-metadata.spec.ts tests/story-writing-status.spec.ts tests/story-directives.spec.ts tests/story-guidance.spec.ts tests/story-reading-pov.spec.ts tests/story-depth.spec.ts tests/daily-reply-integrity.spec.ts tests/bubbles.spec.ts tests/memory-integrity.spec.ts tests/chat-context-regression.spec.ts tests/request-diagnostics.spec.ts tests/memory-context.spec.ts tests/chat.spec.ts tests/lore-trigger.spec.ts tests/timelines.spec.ts tests/story-response.spec.ts tests/generation-tasks.spec.ts tests/story-output-budget.spec.ts tests/story-direct-play.spec.ts tests/story-turn-recovery.spec.ts tests/story-failure.spec.ts tests/story-operations.spec.ts tests/wizard-document-safety.spec.ts tests/chat-history-window.spec.ts tests/presentation-assets.spec.ts tests/automation-audit.spec.ts tests/automation-lifecycle.spec.ts tests/automation-deadlines.spec.ts tests/automation-request-priority.spec.ts tests/chat-game-events.spec.ts tests/character-life.spec.ts tests/private-notes.spec.ts tests/qq-sync.spec.ts --workers=3 --reporter=list,json
```

其他实际专项入口：

```sh
node --test tests/automation-build-policy.test.mjs tests/qq-context.test.mjs tests/qq-edge.test.mjs tests/qq-baseline-reproduction.test.mjs
# SQL 入口；运行时 QQ_AUDIT_PG 已指向专用本地容器，临时名称不写死在调用中
node --test workers/qq-tests/database.test.mjs
npx playwright test tests/automation-request-priority.spec.ts --repeat-each=10 --workers=3
npx playwright test tests/automation-audit.spec.ts --grep 'deadline lookup|1185 rounds' --workers=1
```

### 基线与失败披露

完整的 main 对照组分别为：API/表结构 11 通过 + 3 失败；扩展记忆/UI 22 通过 + 10 失败；备份/游戏/输入 11 通过 + 5 失败；代表案例 4 通过 + 21 失败，均退出 1。重复组不累加为独立总数。另一个 77 项组因先前执行中断，仅留下 42 项逐项失败观察，没有完整退出码，不能算完整基线。

153 项中，38 项在完整 main 对照组也失败；另外 40 项在中断基线中有同名失败观察；75 项没有同名独立 main 失败证据。代表原因含旧版桌面数组/表数/v7断言、旧 UI 路径和旧摘要测试形状。不能凭测试名或未改动文件就断言全部是旧问题；75 项尚未完整逐项归因。私人记录超时模拟的取消清理问题后续已修复，最终复测通过。见[清单](automation-integration-109-failures.md)。

测试同步保留全部业务断言：退出最后 owner 前先释放全局 owner；读取真实 activeMessages 顺序而非 UUID 主键；QQ 并发回填等待实际完成再要求 3103 条；私人记录刷新通过真实桌面入口打开；超时模拟等待真实 requestfailed 且只缩短第一次请求，正常手动恢复保留真实超时。没有删除或 skip 用例，没有改成伪造成功。

历史中断记录：首次日志 1334 通过/157 失败（1491/1493），无最终退出码，不计完整运行。后来 1497 项中途因发现真实 deadline 缺陷而正常停止：退出 130，347 通过/35 失败/4 中断/1111 未运行，不能计通过。追加的 471 项首轮为 468 通过/3 失败，读完真实错误后修复同资源 FIFO 和两个测试同步问题，再完成最终 471/0。源数据、日志及 JSON 均保留在 `/workspace/scratch/dual-automation-109-integration`。受限沙箱 Node 初跑只有文件级失败；同命令正常权限复跑 32/0，未伪装成最初就通过。

## 部署与 CI 安全

Vercel 的 4 个已有分支禁用项均保留。Netlify 在旧 8222afc 曾产生 Ready Preview（部署 `6b063373ce896b3f7d1784b3`），说明旧忽略条件/提交标记不能单独证明不会构建；其私有日志需账号权限，确切绕过原因未证明，不能猜测。

新增纯函数构建策略覆盖 BRANCH/HEAD/ref、PR #109、两平台；Netlify ignore 提前跳过；npm prebuild 在本 Draft 构建被强制发起时失败关闭，阻止 tsc/Vite/发布新产物。main Production 和其他分支照常，矩阵与 CLI 均测试。官方 Netlify 文档说明 build hook 可绕过 ignore，因此保留后备拦截。外部集成仍可能创建一个被拦截的 job，不能无权限保证云端零额度消耗。

提交使用 skip CI/Netlify/Vercel 标记；不主动 dispatch Actions，不改生产环境变量/域名，不购买额度，不运行部署命令。只推送原功能分支并保持 Draft；推送后的实际状态在 PR 描述/最终回复记录。

## 尚未验证与合并条件

- 真正 iPhone Safari、主屏幕 PWA、中文键盘、后台挂起/恢复；目前仅 Chromium 的 390/430 模拟与布局回归。
- 真实付费服务商的响应/质量/限流和账单；测试未调用付费模型。
- 关闭 PWA 后的云端执行与后台推送；本轮没有新增服务端执行能力。
- 全项目失败尚未全部归因、未在最终代码跑完全项目 1509 项。正式合并前应处理这一验收缺口，不应只依据 Git mergeable 或专项绿色合并。

本轮没有反向合并 main，没有 Production 部署。保留其他工作区及未跟踪成果；只明确暂存任务相关文件，未执行全局 add/clean/reset。

## 相对同步后 main 的完整 PR 文件清单

下列是累计功能差异，包含原 PR 已有的自动任务功能；本轮保留并验证这些实现，不代表全部从头新增。QQ、数据库表定义和 worker 不在功能差异中。

```text
docs/automation-audit-110.md
docs/automation-integration-109-failures.md
docs/automation-integration-109.md
netlify.toml
package.json
scripts/automation-build-policy.mjs
src/ApiSettings.tsx
src/AutomationApiPanel.tsx
src/AutomationSchedulers.tsx
src/Chat.tsx
src/ChatHub.tsx
src/ChatHubScheduler.tsx
src/MemoryCalendarScheduler.tsx
src/MemorySummarySettings.tsx
src/PrivateNotes.tsx
src/ProactiveScheduler.tsx
src/automationActivity.ts
src/automationQueue.ts
src/automationRequests.ts
src/automationSchedulerLease.ts
src/characterLifeGeneration.ts
src/characterLifeScheduler.ts
src/chatProvider.ts
src/chatTypes.ts
src/dailyDigest.ts
src/dedicatedSummaryApi.ts
src/importPlan.ts
src/main.tsx
src/memoryCoreBuilder.ts
src/memorySummary.ts
src/memorySummaryFormat.ts
src/memorySummaryPlan.ts
src/memorySummaryQuality.ts
src/memorySummaryRequest.ts
src/memorySummaryScheduler.ts
src/memorySummaryTypes.ts
src/memoryV2Validation.ts
src/privateNotesArchive.ts
src/privateNotesGeneration.ts
src/privateNotesScheduler.ts
src/proactiveMessages.ts
src/socialGeneration.ts
src/summaryLock.ts
tests/automation-audit.spec.ts
tests/automation-build-policy.test.mjs
tests/automation-deadlines.spec.ts
tests/automation-lifecycle.spec.ts
tests/automation-request-priority.spec.ts
tests/character-life.spec.ts
tests/chat-game-events.spec.ts
tests/chat-hub.spec.ts
tests/memory-summary-format.spec.ts
tests/memory-summary-receipt-return.spec.ts
tests/memory-summary-scheduler.spec.ts
tests/private-notes.spec.ts
tests/qq-sync.spec.ts
vercel.json
```

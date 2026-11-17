# Shared chat banners and phase-game chat linkage

## Scope and baseline

Branch `feat/global-chat-game-events`, isolated worktree `/workspace/claudia-chat-game-events`, based on main `1dba05142929186258385edfbebf90cc86b73af0`. Other worktrees, untracked artifacts and feature branches are preserved. No main merge, Production deployment, paid model call, secret change or schema version upgrade is part of this task.

The current main already contains the phase engine, scoped local instruction libraries, opt-in live interventions, ordinary Daily proactive messages, local chat generation tasks, memory V2, BYOK background infrastructure and backup staging. The remote intervention feature branch still contains its original development commit; it was not merged wholesale or cherry-picked. This work does not replace those game features or change default instruction text.

## Audit findings and implemented boundaries

| Before | Implementation |
| --- | --- |
| Ordinary task replies used a task-local hidden-window notification loop; proactive Daily messages used their own page-scoped toast. | Both publish the same `SavedChatMessage` event only after a successful message transaction. Background reply imports publish through this boundary too. |
| Proactive toast existed only in the Daily phone subtree and opened by character ID. | `GlobalChatNotifications` is mounted beside `SpaceRoot`, survives phone/world/backup page replacement, uses conversation/character/world IDs and validates routing before navigation. |
| Phase state and instruction libraries are localStorage-only, not part of ZIP. | Link preferences use optional global Theme metadata covered by ZIP. Run target is saved in the existing phase session. Instruction library storage is unchanged and still not ZIP-backed. |
| An empty first timeline could throw `PrematureCommitError`. | `getCurrentTimeline` now uses an explicitly async transaction callback. Empty-collection shortcuts were investigated and reverted after they failed to fix the cause. No fake messages are added. |
| New preferences and in-flight event claims initially were not restored correctly in development tests. | ZIP validation and staged import now validate/remap preferences, role/world IDs and event receipt message IDs. Imported in-flight receipts become failed/uncertain, never auto-reissued. |

## Shared message path

`sendMessage` / ordinary proactive generation / phase proactive generation / validated cloud reply import → original message+variant+timeline transaction → commit → `publishSavedChatMessage` → one root notification subscriber → target visibility check → saved-record validation → queued banner or existing permission-gated hidden-window OS notification.

No notification requests a model. Split bubbles are projected to a single bounded text preview from the actual committed message. A failed, interrupted, cancelled or rejected write does not publish a success event. The manager does not poll or scan full chat history, and subscriptions/timers are cleaned up. Recent identifier deduplication is bounded to 2000 entries per application lifetime; producers retain their own transactional idempotency. Pending banner queue is bounded to 20 to avoid unbounded overlay memory; only one banner is visible at a time.

The banner uses a body portal, fixed safe-area positioning, backdrop blur, theme variables, a circular saved avatar, role name, preview and local time. It disappears after about 3 seconds, supports swipe-up dismissal and click-through to the exact Daily/World conversation, and does not focus the composer or change layout. The persistent `聊天消息横幅` switch defaults to on in global phone settings. Existing per-conversation `消息免打扰` suppresses banners without stopping generation or saving; unmuting restores notifications for subsequent messages.

## Game linkage, fees and scope

`忍一下嘛 → 其他 → 角色聊天联动` contains a default-off master switch, independent start/finish switches, 50/60/70/80/90/100% selection (default70) and explicit Daily/World role binding. Enabled settings disclose API costs.

A genuinely new game locks a run UUID, character, world, conversation, timeline, epoch, probability/settings and mode. Resuming does not create another start event. At normal time completion a separate `runId:finish` event is emitted; pause, exit and reset do not emit completion. Starting a later game creates a new run. The run is persisted before dispatch.

The conversation receipt is atomically claimed before random selection or API work. A miss is retained as skipped and makes zero model requests; duplicates and concurrent calls do not bill twice. 100% bypasses the random draw. The finish event uses the original binding even if the player changes page or selected role. A disabled current master switch can stop future events, but never redirect them.

Generation reuses `sendProactiveMessage`, `resolveApi`, `buildContext`, `requestChatReply`, existing variants and timeline commits. Thus conversation API binding → character binding → global default remains authoritative. Scoped persona, world profile, applicable worldbooks, memory and recent conversation are assembled by the original context builder. Only a short structured start/completion record is added, not every instruction card. It is not persisted as a fake user message. The ordinary chat prompt and output parameters are unchanged.

A game attempt shares the existing inactivity-period attempt marker when ordinary proactive messaging is enabled. A synthetic baseline reproduced1 game call followed by a second old-scheduler call; the fix records the attempt at acquisition for both success and failure. Probability misses do not claim an API attempt. This prevents the old scheduler from silently following up a failed game request.

A provider failure or incomplete output does not save a successful proactive message. Existing task-error detail UI is reused, and persisted event failures are visible in the game link card. There is no automatic retry. Busy conversations, changed branches, missing roles or removed world links fail safely rather than writing to another target. Role/world membership is checked again at commit. Uncertain crashed requests are not reissued after refresh.

Receipts are capped at2000 per conversation; reaching capacity reports an error and makes no paid request, preserving all old receipts. This is a conservative local limit, not a claim of unlimited event retention. API failure cannot pause or terminate the game. Audio unlocking is initiated within the start gesture before asynchronous binding reads.

## Compatibility and backup

No new Dexie store/version or destructive migration. New fields are optional; old phase v1 sessions remain valid and have no implicit linkage. Raw chats, message rendering/splitting, Story, memory semantics, provider configuration and default phase cards are not rewritten.

Global preferences survive ZIP export/restore. Merged role/world/message references follow the existing import map, not assumed original IDs. Local preferences win on merge; overwrite takes the imported banner setting. Game settings UI persists field patches transactionally, so a delayed UI snapshot cannot erase a role binding when another control changes; concurrent patches are tested. Imported linkage is disabled for fee safety while retaining probability, event toggles and target mapping; the user can enable it again. No restored processing event is replayed. Restoring game timer/instruction data remains outside the existing ZIP format.

## Background / PWA audit

- Existing `claudia-run-byok` claims jobs with user_id-scoped context and per-job encrypted BYOK credentials; it requires internal worker authorization and server enablement.
- Legacy managed worker is retired with503, and is not a public site-owner-key fallback.
- Existing SW remote push handles display payloads; it does not generate models or open IndexedDB. The frontend validates imported completed jobs before publishing a local success event.
- The existing `BackgroundReplyReconciler` is mounted beside `SpaceRoot` too, so signed-in cloud synchronization is not unmounted by world management or backup pages. Its injected snapshot loader is only a dependency seam for offline tests; production defaults to the existing authenticated fetcher and all transaction guards remain.
- This task neither configures cloud identity/keys/permissions nor uploads game events to a new background service. Game requests are foreground initiated. Runtime suspension or closing PWA can prevent completion, and uncertain attempts are not silently retried.
- Native push still depends on existing installation, notification permission and executor provisioning. No real Supabase executor or iOS push verification was performed; do not claim closed-app generation or delivery.

## Verification plan and evidence

All provider requests in tests are intercepted synthetic endpoints. No production database or real API key is used.

- New browser scenarios cover Daily/World normal success, current-chat suppression, other-chat click-through, world manager routing, single split-reply notification, swipe/queue/dedup, settings reload, normal proactive reuse, independent start/finish probability,100% behavior, world/profile/worldbook/memory/API scope, duplicate/concurrent events, API/network/truncation errors, deletion during request, actual game pause/resume/exit/finish/refresh, mobile settings and simulated PWA safe area/focus/layout, plus real ZIP staging/restore.
- Existing phase suites cover default cards and source mode isolation, pause/red silence, timer/feedback, library CRUD, failed providers, old saves and mobile layouts.
- Chat, keyboard, memory, worldbook, persona, timeline, backup and 10000-message performance regressions are run against the integrated source.
- Exact final counts, commands, screenshots and remaining results are appended after completion. An interrupted run or earlier failed run is not a pass.

Earlier failures: sandbox could not start Vite (rerun with local server permission); empty timeline async callback; a test omitted immutable path projection; synthetic Touch data lacked identifier; async checkbox feedback; Vite HMR module identity during restore development (restart server); ZIP preferences/processing restoration omissions; and a test incorrectly assumed original IDs instead of checking the actual remapped role/world/profile relationship. Later checks found the existing main social service legitimately creates one failure per participating friend: an unmodified-main Mock produced exactly two requests and failures for a/b. The old single-role test was updated to assert both role bindings and exactly two requests even after retriggering. Story withdrawal checks now collect the unique sequence in one DOM snapshot instead of strict-locating across two asynchronous frames; database path and request-count assertions are unchanged, and unmodified main passed the original test three times. No Story production code was changed. Assertions were corrected to verify actual behavior; no tests were removed or skipped.

## Remaining acceptance limits

Real iPhone Safari/PWA, actual Chinese keyboard/safe-area rendering, real API model behavior and native Web Push are not verified by Chromium viewport tests. Model adherence cannot be guaranteed. No paid semantic test was run. Runtime/DB failures preserve data and avoid automatic paid retries, which can leave an uncertain event without a delivered message. Game/queue/receipt capacity limits above remain explicit.

Await user review in Draft PR. Do not merge main or publish Production.

## 最终本地验收（2026-11-17）

| 检查 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，既有大包体积警告保留 |
| `chat-game-events.spec.ts` + `proactive-chat.spec.ts` | 31通过，0失败 |
| 聊天／键盘／错误／人设／世界书／时间线等21个文件 | 178通过，0失败 |
| Story／向导等12个文件 | 172通过，0失败 |
| `npm run test:memory-regression` | 150通过，0失败 |
| 原有5份 phase 游戏测试文件 | 81通过，0失败 |

178与172两组来自原完整350项命令的全部文件，文件集合交集为空；因环境会话重建，分组运行并分别记录退出码。所有上述组均实际正常结束、退出0。记忆组与聊天组部分重叠，不能把全部表格数字累加为独立用例数。没有运行整个仓库所有测试文件，没有手动触发 GitHub Actions。

测试命令：

```sh
npm run typecheck
npm run build
npx playwright test tests/chat-game-events.spec.ts tests/proactive-chat.spec.ts --workers=1 --trace=retain-on-failure
npm run test:chat-regression -- tests/keyboard-auto-reply.spec.ts tests/error-scope.spec.ts tests/grounded-character-generation.spec.ts tests/lore-atomic-injection.spec.ts tests/time-marker-bubble.spec.ts tests/time-marker-leak.spec.ts tests/performance-render.spec.ts --workers=1
npm run test:memory-regression
npx playwright test tests/phase-play.spec.ts tests/phase-instructions.spec.ts tests/phase-interventions.spec.ts tests/phase-issue14.spec.ts tests/phase-default-cards.spec.ts --workers=1
```

第三行之后的350项集合实际按文件名含 `/story-` 或 `/wizard-` 分到Story组，其余文件为聊天组，集合不变。未删除、跳过任何原命令用例。原先348通过/2失败、中途环境回收无完整结果的日志均不计为最终通过；修正测试同步后以上述正常结束结果为准。

性能组保留100/1000/10000消息渲染、CSS、历史编辑/分支/引用断言。另在10000消息、20000手动记忆修订、5000总结凭据的合成样本中，实际保留10000原消息，DOM120行；进入聊天1066ms、自动化输入操作232ms；有效路径717.7ms、记忆上下文402.1ms。没有CPU节流，也没有真机或内存峰值测量，环境重建前后的数字不构成受控A/B对比，不能解释成每键真实延迟。

运行证据保存在本机 `/tmp/chat-events-final/`：`type.log`、`build.log`、`features-complete.log`、`chat-partition.log`、`story-partition.log`、`memory-complete.log`、`game-complete.log`，各分组另有 `.exit` 文件。日志不含真实用户数据或密钥，不纳入Git提交。

界面截图位于本地 `artifacts/chat-game-banner-{390,430}.png`、`artifacts/chat-game-settings-{390,430}.png`。它们是隔离数据下的实际页面渲染，不是真实iPhone截图，未混入源代码提交。

一次开发环境移动测试曾出现意外返回桌面，未保留足以定因的导航证据；随后该场景连续3次和最终专项重跑均通过。未为此猜测修改导航/视口代码，仍需真实设备观察。浏览器模拟不等于Safari/PWA真机通过。

## 真机验收方法

1. 在测试分支的 Preview（如自动生成）中使用隔离测试角色和自己的测试API；不同域名不会共享正式站本地数据库，本工具不会自动导入正式聊天或密钥。
2. 系统设置开启「聊天消息横幅」，发送普通Daily/World消息后离开会话，确认成功回复已入库才通知；停留目标聊天时不通知，免打扰角色不通知。点击横幅应进入对应角色和世界。
3. 「忍一下嘛 → 其他 → 角色聊天联动」开启、选择目标世界/角色、设100%并分别验证开始和结束开关。每个命中事件会消耗现有API额度，最多两个联动事件/局；本轮自动化没有调用真实模型。
4. 暂停、继续、快速退出应不重复发开始消息；退出不产生完成消息。正常完成后验证对应聊天保存的消息、横幅及点击目的地。
5. 验证切换页面/世界、刷新恢复、概率50%及失败后无自动重发；若改变剧情分支，旧绑定保守失败，不把旧事件写入新分支。
6. 从主屏幕PWA检查顶部安全区、上滑收起、输入焦点和现有游戏控制；关闭PWA后的生成/原生推送不在已验证承诺内。

## File-level change list

- `docs/CHAT_GAME_EVENTS_AUDIT.md`
- `src/Chat.tsx`
- `src/ChatBannerSettings.tsx`
- `src/GlobalChatNotifications.tsx`
- `src/ProactiveScheduler.tsx`
- `src/backgroundReplyImport.ts`
- `src/backupService.ts`
- `src/chatBannerSettings.ts`
- `src/chatMessageEvents.ts`
- `src/chatNotificationNavigation.ts`
- `src/chatService.ts`
- `src/chatTypes.ts`
- `src/generationTasks.ts`
- `src/globalChatNotifications.css`
- `src/importPlan.ts`
- `src/main.tsx`
- `src/phasePlay/ChatLinkSettings.tsx`
- `src/phasePlay/PhasePlayApp.tsx`
- `src/phasePlay/README.md`
- `src/phasePlay/chatLink.ts`
- `src/phasePlay/chatLinkTypes.ts`
- `src/phasePlay/engine.ts`
- `src/proactiveMessages.ts`
- `src/store.ts`
- `src/timelines.ts`
- `tests/chat-game-events.spec.ts`
- `tests/error-scope.spec.ts`
- `tests/proactive-chat.spec.ts`
- `tests/story-operations.spec.ts`

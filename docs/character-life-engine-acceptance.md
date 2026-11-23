# Character independent life engine — branch acceptance

> The original development notes below are historical. PR #103 integration is explicitly authorized main → feature only; the final integration section supersedes the old branch-lag/conflict status.

Branch: feature/diary-independent-inner-life. Starting commit: 788ff1b48d7d66191e48827404d4caddfe092272. This task does not merge main, change a production configuration, deploy production, invoke a paid model, or edit another worktree.

## Existing implementation and confirmed gaps

The starting branch had a v1 per-character themes row and diary prompt rules. `advanceCharacterLife` merely changed the last-advanced clock: it did not execute life events. Automatic notes still required a Daily conversation, recent new messages, and a four-message minimum. There was no life tab, life event task, failure recovery UI or Daily chat reader. Existing metadata/ZIP paths treated life rows as generic appearance rows, which could retain an old owner during copied-character restore.

## Implemented flow

- Existing v1 rows remain readable; new optional fields add opt-in settings, established occupation/interests, revision, attempts, source/confidence, progress and unconfirmed proposals. Corrupt data is reported without overwriting it. No Dexie version/schema upgrade.
- `characterLifeGeneration`: one foreground update per role, ordinarily at most once per six hours; first update has zero inferred offline duration. It uses the existing role/Daily API binding, applicable global Daily lore, scoped memory and the last 30 effective messages. No World or Story input. No existing diary is promoted into life facts.
- The request returns a bounded patch: at most three existing-event updates and two new events. Updates refer to an existing ongoing event ID. Exact-title repeats are suppressed. Only self-actor additions are accepted. Events remain explicitly simulated. Confirmed high-risk text/major category goes to a separate proposal list; it does not enter life/chat context until the player explicitly authorizes it. Manual user changes take precedence via revision/source checks.
- A task claim is persisted before the request. No network is held inside a Dexie transaction. A 90-second request timeout and visibility/pagehide cancellation stop active work when possible. Failed/unknown interrupted work is never silently replayed; explicit recovery is available after its three-minute lease expires. A stale task cannot mutate a replacement task's revision. Successful state updates commit in one transaction after rechecking the role and effective chat source.
- `CharacterLifePanel`: existing Private Notes gets the Life tab, persisted opt-in/ordinary-event switches, focus/mood/established traits, event statuses, progress, pause/resume/end/delete and major proposal confirmation. Async subscriptions clean up on owner change, and the panel is keyed by owner. Existing diary/memo/dream/comments/themes/background functions remain.
- Automatic notes no longer require fresh chat when independent life is enabled and an interval is due. Important-event-only mode still requires real new interaction. The original 60/180/custom interval settings remain. Dreams use their own paid-attempt lane and do not consume/block diary progress.
- Source deduplication includes the current interval slot; an unchanged character without new messages can therefore write the next due diary. An unknown expired prior diary request blocks automatic retry even after crossing intervals. Existing successful notes remain the schedule cursor. Failed task status persists and is visible in settings.
- `characterLifeChat` performs one bounded life-row read only for relevant Daily topics. No model request or simulation occurs during chat assembly. It appends only within the existing remaining system budget, after persona, lore, memory and raw-history allocation, with at most 1800 characters. Unrelated topics, disabled life, other roles and World/Story contexts do not receive the data.
- Existing ZIP generation/encryption/key options are unchanged. Import reuses the importer's character/collision mapping for life rows even when appearance is retained. Conflicting nested events are preserved using the existing mapping; restored in-flight tasks require manual recovery. Local canonical chat and memory stores are never written by this engine.

## Scope and cost limits

Opt-in is default off. Enabling explains life and diary calls can each cost API tokens. No server scheduler, new credential system or shared key exists. Closing PWA does not run a background engine. Reopening/foreground only performs an eligible single update, never one call per missed interval. At most one role is checked per foreground scheduler pass; no offline catch-up request loop.

Capacity: 40 life events, five major proposals, the latest 20 progress records per event, 180 KB total state; no automatic deletion of chat, diaries or memory. New content exceeding capacity fails without replacing old state. Only bounded selected life details enter a request. Existing shared path resolution still has a cold cost for long histories; the added chat life lookup itself does not query the messages table.

## Safety boundaries

Structured actor/category rules, explicit proposal authorization, provenance, scope isolation, deterministic source/revision validation and conservative high-risk/affection guards are enforced locally. Diary/comment prompts also preserve the player's affectionate baseline without requiring submissive or identical personalities. These are NOT proof of complete semantic safety: a model may mislabel or paraphrase an unsupported event, miss nuance, or express hostility indirectly. Genuine provider quality and human judgment remain necessary. No claim of 100% model obedience or real iPhone compatibility.

## Reproduction history

- Two new counterexamples failed before correction: an independent diary could not write its next hourly interval without fresh chat; a failed manual dream blocked automatic diary generation. Both now have passing real-entry/IndexedDB tests.
- Two further counterexamples failed before correction: an obsolete task's failure handler invalidated a newer claim; an expired diary lease replayed silently at a new interval. Both now have passing regression tests.
- An early combined run had 58 passing/one mobile reload selector timeout; a subsequent unchanged-assertion complete run passed 62/0. Final runs and any remaining failures are recorded below, not added as unique cases.

## Manual device acceptance

1. Open the feature build, Private Notes, select a role, Life tab. Default autonomous switch must be off. Enable after the cost notice; optionally set confirmed occupation/interests.
2. Trigger a manual advance, verify event/source/progress, pause/resume/delete a test event, switch role and return.
3. With interval notes configured, verify a diary without new chat; dream and comment failure must preserve the diary cursor and existing player comment.
4. Ask the Daily role a relevant life question, then an unrelated question; verify no forced repetition. Open a World conversation and verify isolation.
5. Background/close/reopen during a request; inspect persisted failure/unknown status before manual recovery. No promise of calls while closed.
6. On real iPhone Safari and standalone PWA, check 390/430-equivalent layout, keyboard, scrolling, themes and safe areas. Local Chromium screenshots are not a substitute.

Final tests, performance sample, branch lag, commit and PR are reported with this delivery.

## Final local verification

| Command | Actual result |
| --- | --- |
| `npm ci --cache /tmp/character-life-npm-cache` | exit 0 |
| `npm run typecheck` | final exit 0 |
| `npm run build` | final exit 0; existing >500 KB bundle warning |
| `npx playwright test tests/character-life.spec.ts tests/private-notes.spec.ts --workers=1` | **72 passed, 0 failed, exit 0**: 40 life cases plus 32 unchanged private-note cases |
| `npm run test:chat-regression -- --workers=1` | **284 passed, 0 failed, exit 0** |
| Expanded affected group (life/private notes/chat context/memory context/lore/generation tasks) | **110 passed, 0 failed, exit 0**, before the final snapshot-lock reorder/provenance correction; those final changes were then rechecked by the 72-case group |

These groups overlap; do not add their counts as independent unique tests. The entire repository test inventory was not run. No paid API test, real Safari/WebKit session, real PWA lock-screen session or user database test was performed.

Additional confirmed fix: life and diary paid work now share exclusion through the existing per-owner note lease. Diary snapshots are taken only after acquiring that lease; a life claim checks it atomically. Counterexample initially failed (second paid call and stale diary), then passed in both directions. The aborted hot-update run returned exit 143 and is not counted as a pass; all final above runs completed normally.

Additional confirmed fix: a model update of a manually recorded event previously inherited its manual/confirmed provenance. A failing regression demonstrated it. AI progress now becomes simulation/simulated, and the prior original detail is retained in its progress history.

A local Chromium 10,000-unrelated-message sample measured the added bounded life context lookup at approximately 0.5 ms, with **zero message-table reads**. This is a component sample, not an end-to-end chat-entry or native iPhone benchmark. Mobile layout and management tests ran at 390px and 430px; screenshots are `/tmp/character-life-390.png` and `/tmp/character-life-430.png`.

## Remaining integration boundaries

This branch intentionally does not merge or rewrite main. Before this task's commit it was 6 commits ahead / 7 behind origin/main (6d263633...), including main's independent private-notes fullscreen/header and large-memory changes. They have not been reversed, overwritten or incorporated into this development branch. Latest-main integration and its combined runtime must be checked before a production merge.

Life is per-character, real-time simulated continuity, not an automatic replay of the chat timeline. In-flight edits/branch changes invalidate a result; previously saved simulated life is not silently erased when chat history is rewound. It is always labeled separately from canonical chat facts. The engine does not rewrite chat branches or memory.

Semantic safeguards are conservative and principally tested with Chinese examples; they are not a universal language/meaning classifier. A model can mislabel a major event or paraphrase unsupported claims. Real-model review is still necessary. Very large role counts and cold full-path reads have not been benchmarked; no claim that this feature solves every pre-existing iPhone performance issue.

Delivery is an independent feature commit and Draft PR. No main merge, production deployment, environment change, shared-backend upload or production-user data operation is part of this task.

## PR #103 final integration — 2026-11-23

Remote feature HEAD was 93facf8a959bb306e3d2a2aee31da2d88f29c36d; worktree was clean. Both user fixes 5e281c1e and 93facf8a were fast-forwarded before merging main 6d263633d7e40242cea5c30ced582d6537b4d87f into the feature branch. No main ref/worktree was modified, no other feature branch was merged, and no existing work was reset or removed.

### Conflict resolution and defects

- PrivateNotes.tsx: keep five-tab Life type, CharacterLifePanel, automatic failure status, all original note/comment operations, and main's settings event listener/navigation. Remove the duplicate internal home header in favor of the shell header.
- PrivateNotes.css: preserve life-only controls and five-column tabs, plus main's full-width flex viewport, sole inner scroll area, fixed shell header, narrow-screen padding and safe-area variables. No scale, height offset, negative margin or new viewport calculation.
- main.tsx auto-merged: retain both the global life scheduler and main's private-note shell title/settings button.
- A real navigation bug reproduced at 390/430 widths and 568/844 heights: opening settings after scrolling a long life list left the Return control outside the viewport (ratio 0). The existing private-note scroll container now starts at zero when its internal page changes. This is explicit local-page navigation, not a document scroll or viewport-height workaround. All four unchanged in-viewport assertions then passed.
- One original private-note test still targeted the obsolete exact label “返回”; untouched current main failed the same test. Updated only that selector to the published “返回记录”, preserving async ownership, saved-note, dream and API-count assertions.
- Affection review reproduced nine real-entry failures: explicit denial of hatred and concern about an established player behavior were rejected by the old guard. Validation now distinguishes narrow explicit negation/behavior complaints in a temporary copy; the original AI text is never rewritten. Life, diary and comment paths all preserve exact wording. Four negative controls still reject personal rejection, sarcastic negation and mixed hostility. Evidence, actor/role, major-event, scope and transaction checks were not removed.

### Actual final commands/results

| Group | Actual result |
| --- | --- |
| npm run typecheck | final exit 0 |
| npm run build | final exit 0; existing large-bundle warning |
| Life + private notes + initial integration | 77 passed / 0 failed, exit 0 |
| npm run test:memory-regression -- --workers=2 | 233 passed / 21 failed, exit 1 |
| npm run test:chat-regression -- --workers=1 | 284 passed / 0 failed, exit 0 |
| Final life + private notes + expanded integration/affection + lore atomic injection + grounded character generation | 95 passed / 0 failed, exit 0 |

The final 95-case run followed the affection fix and a final typecheck/build. The broader memory/chat runs preceded that isolated guard change; memory sources, source validators, request budgets and chat generation were unchanged by it. Groups overlap; do not sum them as unique cases. Actual logs were retained under /tmp/pr103-*. No paid model, real user database, real iPhone Safari, or real standalone-PWA test was performed.

### Baseline failures are not ignored

An untouched git archive of the exact current main was tested against the same 21 red memory/backup cases plus the stale private-note selector: **22 failed, exit 1**. The feature's full memory suite has the exact same 21 failing case identifiers; automatic set comparison returned identical=true and new_failures=[]. The selector failure was separately fixed as described above. This establishes no new memory regression, not correctness of those baseline behaviors.

Categories: five ZIP early-limit/UI/encryption-UI cases; three magnetic concurrency/outgoing-request cases; seven summary format/parameter/diagnostic cases; two summary quality cases; one receipt-to-prompt case; two scheduler cases; one memory-management short-summary case. Some are obsolete expectations, others are unresolved behavior/compatibility defects. No tests were deleted, skipped locally or weakened. They remain separate work rather than silently broadening this integration into another memory-system redesign.

Exact unchanged red cases:

```text
tests/backup-zip.spec.ts:16:1 › 打包超限在读取数据前停止，中断不返回半份ZIP，密码错误不能降级成未加密
tests/backup-zip.spec.ts:17:34 › ZIP手机流程 375px：单次保存、读回预览、确认前不替换数据及分享状态准确
tests/backup-zip.spec.ts:17:34 › ZIP手机流程 390px：单次保存、读回预览、确认前不替换数据及分享状态准确
tests/backup-zip.spec.ts:17:34 › ZIP手机流程 430px：单次保存、读回预览、确认前不替换数据及分享状态准确
tests/backup-zip.spec.ts:18:1 › 加密开关只保护数据不选择Key，密码确认必需，主界面支持加密ZIP读回
tests/memory-magnet-concurrency.spec.ts:23:1 › interrupted claim never auto-retries; explicit recovery requires failed status
tests/memory-magnet-outgoing-request.spec.ts:7:54 › message-level recall reaches actual model request and removing tag stops return: gemini
tests/memory-magnet-outgoing-request.spec.ts:7:54 › message-level recall reaches actual model request and removing tag stops return: openai-compatible
tests/memory-summary-format.spec.ts:10:1 › 58轮格式失败可见诊断、无私密原文，主动重试后只推进本次区间
tests/memory-summary-format.spec.ts:12:1 › 接口拒绝结构化参数无自动回退，非法诊断字段拒绝进入备份
tests/memory-summary-format.spec.ts:7:1 › 复现旧解析器拒绝说明包装，兼容完整JSON/围栏但保持严格逐条校验
tests/memory-summary-format.spec.ts:8:54 › 总结专用JSON参数及实际响应包装兼容 gemini
tests/memory-summary-format.spec.ts:8:54 › 总结专用JSON参数及实际响应包装兼容 openai-compatible
tests/memory-summary-format.spec.ts:9:54 › API明确截断即使JSON完整也不写入、不推进进度 gemini
tests/memory-summary-format.spec.ts:9:54 › API明确截断即使JSON完整也不写入、不推进进度 openai-compatible
tests/memory-summary-quality.spec.ts:11:54 › 合法空结果正常推进；普通事件筛掉后零条也不反复请求 gemini
tests/memory-summary-quality.spec.ts:11:54 › 合法空结果正常推进；普通事件筛掉后零条也不反复请求 openai-compatible
tests/memory-summary-receipt-return.spec.ts:7:1 › verified first-pass summary reaches prompt; edited source invalidates it
tests/memory-summary-scheduler.spec.ts:32:1 › automatic summary: provider 503 ends immediately, then waits another interval
tests/memory-summary-scheduler.spec.ts:61:1 › automatic summary: authentication error stops after one attempt and defers
tests/memory-v2-management.spec.ts:9:1 › 20轮自动总结真实路径更新短期UI且只调用一次，手动核心原样保护
```

### Layout, persistence and policy evidence

The four layout cases record actual getBoundingClientRect and scroll positions. For 430×844, shell header is y=0..48, notes and app-scroll are y=48..844 with width430/height796. app-scroll overflow is hidden, notes overflow-y is auto; long content scrolls internally from0 to8005 while document scroll remains0 and header position stays unchanged. All five tabs remain visible with no horizontal overflow. Screenshots: /tmp/pr103-integrated-{390,430}-{568,844}.png. This proves Chromium layout only, not real Safari rendering or keyboard behavior.

A joint real-entry fixture creates40 chat rounds, runs the main summary pipeline with simulated API, writes/reads confirmed memory and progress, and validates an isolated ZIP restore containing both life and memory. The life-only marker is absent from summary requests and confirmed memory, while the restored life row retains it and all80 source messages remain. Existing life/private-note suites also cover encrypted ZIP, owner remapping, legacy data, concurrent tasks, failures and manual recovery.

Role affection rules remain in life progression, diary, comment replies and the bounded Daily life context. Complex moods remain possible; no actor card, user message, world book, relationship record or canonical memory is rewritten. Ordinary life does not require player audit; major proposals still require explicit authorization. Semantic safeguards remain heuristic and Chinese-focused, not a proof of perfect model compliance.

### Delivery and remaining gates

Only the authorized feature branch is pushed, once after verification; PR #103 stays Draft. The existing Vercel per-branch deploymentEnabled map now disables feature/diary-independent-inner-life only, retaining all other entries and main's production behavior, to avoid an unnecessary Preview build. No service environment, domain, credential, database schema or Production deployment is changed.

Code integration should be evaluated against the documented current-main baseline: no new failures and no unresolved merge markers. It is NOT an all-green full-repository claim. Existing21 red cases remain, and real iPhone Safari/PWA keyboard/safe-area/background behavior plus genuine provider/personality quality require further acceptance. No Production merge is authorized by this task.

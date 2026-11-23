# Character independent life engine — branch acceptance

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

# Issue #110 / PR #109: foreground automation audit

Date: 2026-11-25. Branch: `feature/dual-automation-api`, original HEAD `1dff7f3c16e54d0f5ea0f096ecdba208b2c1d769`.

## Scope and release safety

The separately authorized QQ task, PR #108, was merged first: main merge commit `13e943145ddc2bde9745dcd6ad425c124a06a961`. This automation work remains on its original feature branch and Draft PR #109; main is not merged into this branch or modified again. No deployment command, database migration, production secret change or paid-model test was executed. Other worktrees and existing screenshot artifacts are retained. Vercel Git deployments are disabled for this branch; Netlify's ignore condition applies only to this branch, with unchanged behavior for main/other branches. Commits use CI/deploy skip markers. No Actions dispatch is performed.

The branch's original main base is `5a6c95a6f2b1a53805fa8f00584e8766d65e7345`. The newer main contains the separate QQ merge. This PR changes neither the QQ worker nor its cloud database, and must be integrated by normal three-way review rather than replacing main.

## Confirmed defects, evidence and repairs

| Code / entry point | Confirmed trigger and effect | Repair / regression evidence |
| --- | --- | --- |
| `automationQueue.ts`, `automationRequests.ts` | Whole-task global lock let a long multi-chunk summary monopolize all automation. Readiness was checked only at task start. | Task-specific cross-tab leases, bounded orchestration slots (8 total / 2 per class), FIFO cross-tab **request** turns. Tests put a short task behind a blocked long task and alternate actual request turns. |
| `automationActivity.ts`, `chatProvider.ts` | An enabled dedicated configuration was assumed to represent an independent endpoint, even if it reused the chat credentials. | Compare the actual endpoint/key resource, observe foreground requests without ever queueing/cancelling ordinary chat. Same-resource automation waits; genuinely separate API can proceed concurrently. |
| `automationRequests.ts`, `generationTasks.ts` existing owner | Ordinary chat's `saving` phase precedes persisted `sendingUntil`. | Include the existing generation-task state at request admission. Regression delays the actual save, asserts zero automatic calls until chat finishes. No new task ID/database system. |
| `chatProvider.ts`, automation transport | Existing role-compatibility retry ran inside one occupied slot and bypassed another busy/source check. | Automation releases its slot and queues that single fallback at the tail; ordinary provider fallback unchanged. Tests assert another queued task goes first and a newly busy chat prevents the fallback. |
| `memorySummaryRequest.ts`, core/digest/life/notes/proactive/social | Timers started while waiting for ordinary chat, causing false timeout/expired-job failures before a network request. | Start/stop provider timeouts on actual admission; revalidate source and renew primary lease immediately before sending. Tests wait beyond the old primary lease with zero network calls, then commit once after release. |
| `proactiveMessages.ts` / `ProactiveScheduler.tsx` | Persisted attempt anchor permanently suppressed later success/failure/probability-miss cycles. Scheduler repeatedly materialized full history. | Timestamp the attempt and compute a real next deadline. Indexed legacy user tail / current-path parent traversal replaces a full history clone. Per-conversation lock protects automatic, force and game paths; game receipts do not poison inactivity anchors. Failures keep the switch enabled. |
| `privateNotesScheduler.ts`, `main.tsx`, `PrivateNotes.tsx` | Notes depended on enabled life or mounting the notes page; no independent automatic dreams. | One independent rotating scheduler for existing note/life users, no mass creation for never-used roles. Remove the duplicate page timer. Explicit default-off dream opt-in, at most once per 24 hours, separate diary/dream cursors. Configured diary interval can work without new chat. |
| Notes/life startup arbitration | An ineligible/no-op notes check could take the owner's lease just before the only reopen life pass, delaying it until the next minute tick. | Defer the notes owner claim when that same owner's life is actually due/running. Disabled or failed/cooling life does not gate standalone notes. Actual app reload regression checks one successful eligible life advance. |
| `privateNotesArchive.ts`, `privateNotesGeneration.ts` | Late results could commit after a replacement owner; expired/changed-source jobs could immediately rebill. | Heartbeat + owner-token commit fences, 30-minute failure cooldown, bounded same-source recovery; unknown expired tasks first become visible failed state. Preserve original records and comments; show dream failures too. |
| `memorySummary.ts`, scheduler | Backlog and old failure recovery needed actual execution verification; repeated cooling-job checks reconstructed full history. | Verify existing `continueBacklog=true`; one logical group per orchestration turn, tail continuation after success. Cheap persisted eligibility before source reconstruction, bounded cooldown recovery without disabling switch, source check at admission. Actual 1,185-round IndexedDB test verifies receipts, saved memories and remaining rounds. |
| `memorySummaryPlan.ts`, format/quality helpers | Failed source recovery fell back to a simple parser, admitting invented facts. Conversely, all rejected nonempty candidates could become a zero-memory successful receipt. | Remove unsafe bypass. Recover optional metadata only with source evidence; retain mixed valid candidates. Genuine empty or explicit low-utility filtering may complete; unsupported source/numbers/conditions do not write or advance. Actual source/receipt/database regressions distinguish these paths. |
| `memorySummaryPlan.ts`, `memorySummaryQuality.ts` | A short quote could omit negation (`我不喜欢咖啡` → `喜欢咖啡`) or the prerequisite `只有你同意`. Local browser reproduction admitted both wrong claims. | Reuse the existing source-sentence/context utility, including original turns for fragmented messages. Tests assert zero writes/receipts for unsupported claims, while an independent valid candidate survives. This is conservative local validation, not full semantic proof. |
| `memorySummaryTypes.ts` and sparse consumers | Completed chunks were typed as dense values; split recovery inserted `null as any`. | Explicit nullable chunk type; resume/counting keeps later successes. Actual ZIP rehearsal/restoration plus retry verifies paid successful pieces are not repeated. |
| `memoryCoreBuilder.ts`, scheduler | Core synthesis depended on the tail of primary success; old failure anchors could permanently suppress it. Two separate writes could leave a core without a successful attempt record. Deleted cores could reappear. | Independent five-valid-receipt task, bounded recovery; validate long-memory revision/source before and after API. Atomically save core+attempt; tombstone-aware dedup prevents recreation of deleted core. Injected write-failure test preserves five primary receipts, rolls back core, manual recovery creates exactly one. |
| `dailyDigest.ts` | One task held seven calendar windows, chunks were 16k characters regardless of budget, paid merge results were not checkpointed. Replanning could discard successful chunks. | One automatic window per turn; conservative token/context/output budgeting, source-bound cached merge tree, bounded attempts, optional checkpoint archive (max 3) and existing capacity guard. Validate/remap optional archive in backups. No schema/version increase. |
| `characterLifeGeneration.ts` | Existing affection guard was disconnected. New explicit player decisions could enter simulation without a user source. | Reconnect existing nuanced relationship guard; source-check explicit new player decisions/consent, not ordinary self-life events. Negation/complaint controls remain tested. No claim of perfect model behavior. |
| All schedulers / `summaryLock.ts` | Queued callbacks could survive disposal; backup maintenance or cross-tab lease expiry could race late results. | Disposal/settings/source preflights; owner fencing; backup guard blocks new requests and holds result delivery until safe. Hidden/offline transport sleeps until foreground/online wake instead of polling. |
| API panel / per-feature failure UI | No cross-task queue visibility, ambiguous failure/recovery costs. | Safe task counts, active classes, waiting/failure category and next check; persisted per-feature failures remain authoritative. No credentials/chat text in queue diagnostics; explain finite recovery may be billed. |

### Additional end-to-end boundary reproductions

After the first fresh 557-case run passed, three additional negative tests **failed before their fixes** (exit 1, 3 failed / 0 passed):

1. `memoryCoreBuilder.ts`: the earliest five-receipt group could have no retained long memory for a duplicate/deleted source, permanently blocking later fully sourced groups. Scan fixed five-receipt groups for the earliest complete unprocessed one; leave incomplete sources/receipts unchanged. The regression creates ten real receipts (first five include four duplicate-only receipts), and requires one core from the later complete five, not from partial evidence.
2. `privateNotesGeneration.ts`: disabling automatic dreams during a shared-API wait still allowed that queued request to be billed. Recheck the dream switch at actual admission; manual dream creation remains explicit. The regression requires zero transport calls, zero records, and a visible failed/cancelled operation after the switch is disabled.
3. `characterLifeGeneration.ts`: a live life task waiting behind other work had no heartbeat and could be marked expired after three minutes. Renew only owner-token lease metadata (not the semantic life revision), clear it on completion/failure, and fence replacement tokens. The regression waits four simulated minutes, performs a second scheduler check, then requires exactly one successful request and no false expiry. Crashed pages without heartbeats retain the existing expiry/recovery behavior.

The real scheduler entry received one further negative test: with a not-yet-due diary and dream opt-in enabled, the scheduler produced **zero dreams** (exit 1, 1 failed / 0 passed). Diary and dream orchestration were admitted in parallel, so the per-role generation guard silently rejected the dream. `privateNotesScheduler.ts` now queues that owner's dream after its diary check releases the existing guard. It does not merge their cursors, records, intervals or failure states; even a no-op/failed diary check releases the path for the independent dream check. Final tests require one actual generated/saved dream, no duplicate request and the original diary unchanged.

The first fresh full run passed 557 cases. A later freeze run was intentionally interrupted to add the scheduler regression (84 passed, 3 interrupted, 473 not run, exit 130); that is not reported as a complete pass. The final fresh full run includes all four boundary regressions and is counted separately below.

## Call-site audit boundaries

Primary, five-group core and calendar digest; automatic social posting and role comments/replies; proactive normal/force/game messages; life progression; diary/memo/dream generation all use the same actual-request gate. Explicit manual social post and note-comment reply remain foreground requests. User-initiated magnet tagging/day review/game library or intervention preparation/Story wizard generation remain explicit actions, not silently converted into background jobs. Foreground request tracking protects their existing execution as well.

Memory retains original turns, source checks, uncertainty, conditional statements, relation changes and branch isolation. Existing redaction before summary transmission is retained; no new adult-content blacklist is added. Unverified prose is not repaired into fictional facts. Semantic contradiction resolution and perfect recall are not claimed.

## Data and billing compatibility

- No Dexie version increase, table reset, destructive migration, chat deletion or key/config mutation.
- Keep existing `dedicatedSummaryApi` JSON key; disabling independent mode retains its saved copy and credentials. Ordinary API bindings/defaults unchanged.
- New fields are optional. Existing interval 40, old receipts, failed checkpoints and sparse completed results remain supported.
- Runtime summary leases remain excluded from backups; existing live private-task import behavior stays intact. Plain ZIP, encrypted ZIP and consented API-key options are exercised with isolated synthetic data.
- Finite recovery can issue another paid request after a failure/unknown remote outcome. Successful saved fragments are reused. It is impossible to prove a disconnected remote request was not already billed; no promise of exactly-once billing is made. Primary auth/quota/safety/config failures require explicit correction/recovery; other features retain bounded attempts or their configured next-cycle cadence, never a rapid unlimited retry loop.

## Validation history and final results

All APIs are local synthetic/mock responses. Tests exercise real IndexedDB transactions, immutable paths and isolated ZIP candidates, not only parser functions.

Earlier development runs included a completed 552-case run (538 passed / 14 failed), interrupted runs (exit 130, not passes), and a 51-case run (50 passed / 1 invalid timeline-edit fixture). The original unmodified `1dff7f3` baseline reproduced all 13 selected legacy memory failures and seven selected life/chat-hub failures. Tests were synchronized with the actual unforced JSON-compatible protocol, real chunk count/output budget and immutable timeline-edit entry point; source/no-write/no-progress/call-count assertions were retained. New regressions exposed and drove the code fixes above. No test was deleted or skipped. A subsequent 124-case affected set passed before the environment restart.

The temporary `/tmp` logs from that environment did not survive restart. Therefore final validation is rerun in the restored environment with persistent logs under `/workspace/scratch/dual-automation-110`, and only those fresh results are used for final pass counts below. Repeated runs are not added into a fictitious unique-test total.

The frozen final source is validated with the exact commands and exit codes below.

### Single-worker measurement after the final boundary fixes

Measured in local Chromium with synthetic data, not an iPhone or total chat latency:

| Latest-user deadline lookup | Original full-path materialization | Indexed/current-tail lookup |
| --- | ---: | ---: |
| 1,000 messages | 19.1 ms | 0.9 ms |
| 10,000 messages | 127.9 ms | 0.9 ms |
| 30,000 messages | 492.1 ms | 1.0 ms |

The 1,185-round test used 2,370 original messages, completed 11 logical hundred-round receipts, retained the 85 rounds below the configured threshold, and persisted 66 long memories + 2 cores with 68 mocked requests in 4.34 seconds. It then soft-deleted a generated core and verified it was not regenerated/rebilled. This verifies actual persistence/progress logic, not real-model quality or service latency.

| Fresh final command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | Dependencies installed |
| `npm run typecheck` | 0 | Passed |
| `npm run build` | 0 | Passed; existing large-bundle warning retained |
| `npx playwright test tests/automation-audit.spec.ts --workers=1` | 0 | 38 passed, 0 failed (50.8s) |
| Complete affected regression command below | 0 | **561 passed, 0 failed, 0 skipped (11.8m)** |

The 38 specialist cases are included in the 561-case full run; they are **not** added together. The earlier 138/557-case runs are also not counted again. The tested 40 runtime/test/config files were SHA-256 checked unchanged after the final test completed.

The actual expanded command from `npm run test:chat-regression -- <additional affected specs> --workers=3`:

```sh
playwright test tests/heart-voice.spec.ts tests/chat-snapshot-metadata.spec.ts tests/story-writing-status.spec.ts tests/story-directives.spec.ts tests/story-guidance.spec.ts tests/story-reading-pov.spec.ts tests/story-depth.spec.ts tests/daily-reply-integrity.spec.ts tests/bubbles.spec.ts tests/memory-integrity.spec.ts tests/chat-context-regression.spec.ts tests/request-diagnostics.spec.ts tests/memory-context.spec.ts tests/chat.spec.ts tests/lore-trigger.spec.ts tests/timelines.spec.ts tests/story-response.spec.ts tests/generation-tasks.spec.ts tests/story-output-budget.spec.ts tests/story-direct-play.spec.ts tests/story-turn-recovery.spec.ts tests/story-failure.spec.ts tests/story-operations.spec.ts tests/wizard-document-safety.spec.ts tests/chat-history-window.spec.ts tests/presentation-assets.spec.ts tests/automation-audit.spec.ts tests/private-notes.spec.ts tests/proactive-chat.spec.ts tests/chat-hub.spec.ts tests/character-life.spec.ts tests/character-life-integration.spec.ts tests/memory-large-interval.spec.ts tests/memory-summary-format.spec.ts tests/memory-summary-plain-text.spec.ts tests/memory-summary-quality.spec.ts tests/memory-summary-receipt-return.spec.ts tests/memory-summary-scheduler.spec.ts tests/memory-summary.spec.ts tests/memory-loop.spec.ts tests/memory-v2-digest.spec.ts tests/memory-digest-return.spec.ts tests/memory-global-digest-regression.spec.ts tests/error-scope.spec.ts tests/api-quick-selection.spec.ts tests/restore.spec.ts --workers=3
```

Persistent local logs: `/workspace/scratch/dual-automation-110/validated-{typecheck,build,specialist,regression}.log`, each with its `.exit` file. Negative reproductions are `final-boundaries-before.log` (3 failures before fixes) and `dream-lane-before.log` (1 failure before scheduler fix). These local paths are not hosted artifacts.


## Remaining limits and device acceptance

- Real provider generation, actual service quotas and real iPhone Safari/PWA are **not tested**. Chromium iPhone-sized views and synthetic API responses are not real device/model acceptance.
- This is foreground automation. No promise of execution after iOS closes/suspends the PWA; backend/cloud execution is outside Issue #110.
- Already in-flight automatic work cannot be preempted without risking a duplicate paid request. Ordinary chat starts immediately; later shared automatic calls wait. Endpoint aliases/service-side account-wide quotas cannot be inferred locally.
- Metadata/source validation is bounded but still performs required branch/source checks. Deadline microbenchmarks are not total chat-entry latency or a guarantee of iPhone input performance. UTF-8 cost is a conservative local estimate, not a provider tokenizer measurement.
- The queue status view is in memory, not a new durable task archive; per-feature persisted jobs remain the recovery authority. Optional checkpoint archives have explicit capacity bounds and stop rather than deleting user data when full.

Suggested real-device checks after a separately authorized preview/release: enable shared API and keep sending ordinary messages while a backlog drains; switch to a genuinely separate automatic API and confirm simultaneous work; close/reopen PWA with saved chunks; verify proactive next interval after probability miss/failure; opt in to dreams and check independent diary/dream timestamps; inspect safe failure details and perform explicit recovery after correcting authentication/quota. No deployment is made in this task.

## Files in this change

```text
netlify.toml
src/AutomationApiPanel.tsx
src/ChatHub.tsx
src/ChatHubScheduler.tsx
src/MemoryCalendarScheduler.tsx
src/MemorySummarySettings.tsx
src/PrivateNotes.tsx
src/ProactiveScheduler.tsx
src/automationQueue.ts
src/characterLifeGeneration.ts
src/characterLifeScheduler.ts
src/chatProvider.ts
src/chatTypes.ts
src/dailyDigest.ts
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
src/proactiveMessages.ts
src/socialGeneration.ts
src/summaryLock.ts
tests/character-life.spec.ts
tests/chat-hub.spec.ts
tests/memory-summary-format.spec.ts
tests/memory-summary-receipt-return.spec.ts
tests/memory-summary-scheduler.spec.ts
vercel.json
src/automationActivity.ts
src/automationRequests.ts
src/privateNotesScheduler.ts
tests/automation-audit.spec.ts
docs/automation-audit-110.md
```

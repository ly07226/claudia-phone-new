# QQ / Daily context continuity audit — 2026-11-24

Base: `c582573343ba7ddc067ca507974d0742c1addb82`, independent branch `fix/qq-memory-context-continuity`.
No production writes, model calls, credential changes, rebinding or local data deletion.

## Confirmed defects and evidence

1. **Local-to-cloud updates were gated on QQ-to-local additions.** `src/qqClosedContinuity.ts` only marked context dirty if `syncQqDailyConversation()` returned >0. Local chat, persona/lore edits and successful memory summaries did not do this. The baseline reproduction executes the actual main source with mocked dependencies: zero QQ additions => zero context builds/uploads despite an eligible binding. Replaced with committed-Dexie mutation invalidation, a debounced wakeup of the existing foreground reconciler, and an unchanged-context cache. No second polling loop, no model call.
2. **A UUID existed but did not enforce versions.** `claudia-qq-ai-config` blindly upserted random revisions. Added owner-scoped atomic CAS under a binding lock, prefix/suffix message patches, memory upserts/tombstones and a full replacement on cold/recovery sync. Stable operation IDs make lost-ack replays idempotent. A stale device cannot silently overwrite the winning revision; explicit manual sync is the recovery/confirmation path.
3. **Cloud context was frozen to the most recent local query.** The ordinary local prompt only selects a bounded subset of long memories. The new snapshot separately carries the effective core/long memory catalog and source-verified visible summary receipts. It reuses the existing source verifier and five-receipt core dependency rule, not a new quality filter. Soft-deleted and invalid-source auto memories cannot be reintroduced through this catalog.
4. **Cloud history was just 24 messages, concatenated onto overlapping snapshots.** Both Edge and legacy Node paths now use one shared request assembler, explicit snapshot-covered QQ IDs, fresh tenant-scoped recent history and bounded older source recall. The old code also removed trailing local user messages; those unanswered messages are now preserved. Retrieval does not create facts or call a model.
5. **Readback could permanently fail above 3000 rows.** The previous descending scan buffered up to 30 pages and aborted without any commit above that limit. Readback now commits oldest-first pages, advances only after a successful timeline transaction, and resumes bounded work on later foreground passes. The manual button is a fallback, not the auto scheduler.
6. **An arbitrary matching local ID suppressed a QQ message.** Dedup now requires the active local message's conversation, role and original text to match. Canonical QQ IDs remain binding-independent globally unique cloud UUIDs and never overwrite another timeline's row.
7. **Equal timestamps reordered split bubbles by random UUID.** The new readback RPC orders by `(received_at, coalesce(part_index,0), id)` and resolves old `{at,id}` cursor part indices from the owner-scoped source row. Pending sends are independently rechecked and do not block newer acknowledged records; terminal failures never masquerade as AI replies.
8. **Two paid generations could overlap within a binding.** Claiming now serializes per binding, checks profile/snapshot/message owner equality, and never silently recharges an expired/uncertain paid request. A later message can proceed; the interrupted task retains a diagnostic code. Final commits still use the existing lease-checked finish RPC.
9. **Transport erased useful HTTP errors.** The shared transport retains its old default behavior for WeChat; QQ v2 explicitly opts into reading error responses so 409 conflicts and missing cursors are distinguishable.

## Live read-only checks

Supabase schema/SQL metadata and aggregate counts only; no message/context bodies or credentials were queried. Four connected bindings, four enabled profiles and four snapshots; observed profile/message owner mismatch counts were both zero. This is evidence against an existing obvious owner-ID mismatch, not proof that every live route is correct. Observed message statuses included 20 failed inbound and 5 failed outbound rows; statuses alone do not establish the error cause.

Railway QQ Bridge was Online, one running replica, no recent deployment failures; deployment `fa630cf0-45fa-43cf-bb3b-6147102fd2d3` created 2026-11-20. Healthy infrastructure does not prove prompt correctness. No service variables or raw runtime logs were exported.

## Data and runtime boundaries

* Existing Daily character binding and authenticated Supabase owner remain authoritative. Stable-ID restore can map an old cloud conversation ID to the same local Daily character; no World conversation is accepted.
* Existing persona, current effective worldbook instructions, core/long memories, verified summary receipts and recent text are reused. No chat/memory data is rewritten by uploading a context.
* Images stay local; their existing text is retained, but the QQ text model cannot reproduce the image bytes. This is explicit text-only support, not multimodal equivalence.
* Closed PWA: Railway/Edge continue using the last acknowledged cloud context and QQ history. Unsynced local IndexedDB changes cannot be uploaded after iOS terminates JavaScript. No claim of offline browser execution.
* Cloud messages imported by the existing timeline transaction become ordinary user/assistant messages for subsequent local summary and original-history recall; no second memory store or summary API is introduced.
* Snapshot/document size limits fail explicitly and retain the previous cloud version. They do not delete local history or manufacture a complete snapshot.

## Safe rollout (not executed)

1. Review and test the additive SQL migration locally. Apply it to the intended Supabase project only during an authorized rollout; it adds columns/indexes/functions and does not replace user data.
2. Deploy the updated `claudia-qq-ai-config`, `claudia-qq-sync` and `claudia-qq-ai-run` Edge functions together. The existing Node worker, if used, must also receive the shared runtime modules. Existing bridge credentials and model configurations remain unchanged.
3. Release the frontend after the server supports v2. Legacy clients may seed legacy contexts, but cannot downgrade an existing v2 catalog. A new frontend against an old backend displays a version error and retains data instead of claiming success.
4. Reopen the existing app; do not rebind or clear storage. Confirm an acknowledged sync, then test phone→QQ and QQ→phone with a non-sensitive synthetic fact.

**Repository deployment gap:** production has QQ lease/fragment columns and RPCs not fully represented in the original checked-in QQ base migration. The additive migration includes the lease/fragment columns it needs, but an entirely new QQ installation still needs the pre-existing ingest/finish/outbound runtime setup. This is not a destructive repair of the live project.

## Verification

Actual commands, final counts and remaining limitations follow below. Browser mocks are not real QQ traffic or real iPhone Safari acceptance. PostgreSQL tests use fresh synthetic databases inside a dedicated local Docker container, never the user's Supabase database.


## Additional confirmed blockers found during final verification

* **22 old pending replies blocked newer readback.** Live aggregate-only queries found 22 outbound `generated` rows, all over one hour old, with C2C routes and parent IDs present. Their actual delivery is unconfirmed. The old prefix-only cursor stopped at the first such row. The new owner-scoped pending-aware RPC returns a scan page and independent rechecks in one database snapshot. A single local checkpoint atomically retains both the scan position and pending IDs after the timeline transaction. Later successful records continue importing; old replies are imported only after confirmation. No live status was changed and no reply was resent.
* **Empty polls created timelines.** This could invalidate an open attachment menu even though no chat arrived. Empty/pending-only polls now validate the conversation without creating a timeline. The real manual attachment-menu click is tested.
* **QQ split replies could lose later bubbles from summary input.** The existing summary collector completes a turn at its first assistant message. New QQ tasks therefore retain their original generated reply in the cloud, and after all fragments are acknowledged import that complete reply as one ordinary local assistant message/variant. Existing individually imported messages and user edits remain unchanged. Older records still participate in raw-message recall; already completed historical summaries are not automatically regenerated or recharged.
* **SQL ordering could be undone locally.** IndexedDB projection sorts equal-millisecond rows by local ID. Imported legacy bubbles retain PostgreSQL microseconds and a stable sub-millisecond part-order tie break, so random UUIDs cannot reverse a single reply after refresh. No existing message timestamp is rewritten.
* **CORS rejection had a temporal-dead-zone bug.** The outer JSON response helper was shadowed by a later block-local `const json`, so an untrusted Origin could throw rather than return 403. Independent Deno checks exposed this and pre-existing cursor typing errors; actual handler rejection and Deno checking now pass.
* **Snapshot ownership includes the character.** Both generation paths reject v2 metadata naming a different character before a model request, even if the Supabase user ID matches.

The pending readback protocol is additive; old timestamp cursors and legacy endpoints remain accepted. Cold/legacy protocol state, missing cursor sources and a changed existing restore rollback marker trigger bounded full recovery with canonical dedup. Successful page commits remain resumable. Pending IDs are capped at 1000 with an explicit error rather than silent data loss; the current live aggregate of 22 is below this cap. The service-only view is not selectable by anon/authenticated clients.

## Final verification commands

```
npm ci
npm run typecheck
npm run build
node scripts/build-qq-lore.mjs --check
npx deno check --no-config supabase/functions/claudia-qq-ai-config/index.ts supabase/functions/claudia-qq-ai-run/index.ts supabase/functions/claudia-qq-sync/index.ts
node --test tests/qq-edge.test.mjs tests/qq-context.test.mjs tests/qq-baseline-reproduction.test.mjs tests/wechat-memory-retrieval.test.mjs workers/qq-qr/*.test.mjs
QQ_AUDIT_PG=claudia-qq-audit-postgres node --test workers/qq-tests/database.test.mjs
npm run test:chat-regression -- tests/qq-sync.spec.ts tests/wechat-bridge-protocol.spec.ts tests/wechat-daily-merge.spec.ts tests/restore.spec.ts --workers=1
npx playwright test tests/qq-sync.spec.ts tests/wechat-bridge-protocol.spec.ts tests/wechat-daily-merge.spec.ts --workers=1
```

The PostgreSQL test needs a dedicated local PostgreSQL 17 container named `claudia-qq-audit-postgres`; it creates a fresh synthetic database per run, never resets an existing database and never accepts a remote database URL. It is outside Playwright's test directory so normal browser collection does not require Docker. Baseline source is archived with its Git blob SHA checked, so shallow clones can reproduce the old failure without fetching historical commits.

## Remaining limits / release gates

1. No live QQ messages or paid model requests were sent. Real QQ routing, closed-phone behavior and real iPhone Safari/PWA still require acceptance after an authorized server/frontend rollout. Chromium viewport tests are not a real iPhone test.
2. The 22 pre-existing unacknowledged replies remain unmodified. Their delivery cannot be proven from the stored status; this PR neither calls them sent nor automatically resends them. The exact QQ delivery/acknowledgement failure needs separate live bridge investigation if it continues.
3. This mirrors effective persona, applicable Daily worldbooks, effective core/long memories, verified summaries and a bounded recent text window. **It is not a full cloud archive of all old local raw messages.** A local fact older than that window, absent from saved memory/summary and never previously transmitted to QQ, is not remotely retrievable while the phone is closed. Full incremental source-history mirroring would need a separate bounded, branch-aware source index; do not describe the present patch as that capability.
4. SQL user/binding isolation and cross-character rejection are tested. QQ runtime routing is currently keyed by bot binding. Repository inspection does not establish a verified one-to-one authorization between every external QQ sender and the Supabase owner when a bot is exposed to additional QQ peers/groups. Do not equate the SQL isolation tests with validation of that platform identity boundary.
5. Native QQ provider support remains the existing HTTPS OpenAI-compatible Chat Completions path. No new native Gemini protocol is claimed. Worker/regex behavior on the actual Supabase Edge runtime and provider-specific context limits are not live-verified.
6. Catalog/reference/request budgets remain bounded. Oversized or invalid source data keeps the old cloud context and reports failure; nothing is silently labelled a full sync. A snapshot's real-time block can age while the phone is closed; no closed-browser live clock or unuploaded-data guarantee is made.
7. Large source recall is deterministic lexical/topic recall, reusing the app's existing synonym definitions. It is not semantic-model or real-model memory-quality acceptance. Example tested PostgreSQL scoped recall over 30,000 synthetic rows: roughly 121–242 ms (last measured run: 242 ms) including Docker command overhead on this machine, not an iPhone or production benchmark.

**Do not merge/deploy this Draft merely because local tests pass.** Coordinate the additive migration and Edge rollout and resolve/accept the above identity/full-history scope limitations. Production data, keys, main and service settings remain unchanged.


## Actual local results (no duplicated total)

* `npm ci`: exit 0 (92 locked packages).
* TypeScript and Production build: exit 0. The existing large-bundle warning remains; no build failure.
* Three Edge functions: actual `deno check`, exit 0. The initial 18 errors were fixed and rechecked, not suppressed.
* Combined chat/Story/memory/worldbook/QQ/restore browser run: **313 passed, 0 failed**, exit 0. Subsequent QQ-only changes (pending-aware readback, empty-poll handling, additional recovery cases) were tested separately below; those repeated cases are not added to a grand total.
* Latest QQ + WeChat protocol/readback browser run: **24 passed, 0 failed**, exit 0, including the real attachment-menu button, full QQ reply ZIP rehearsal, memory-source edits, multi-tab changes, pending recovery across refresh and 390/430px bounds.
* Node protocol/request/tenant/baseline-source tests: **31 passed, 0 failed**, exit 0.
* Actual PostgreSQL 17 isolated tests: **8 passed, 0 failed**, exit 0. Expected permission/invalid-cursor exceptions are asserted negative cases, not uncaught failures.
* Additional ZIP/restore/memory/lore browser run: **48 passed, 5 failed**. All five failing IDs/assertions also reproduce in a separate untouched `c582573` worktree: baseline ZIP run **5 passed, 5 failed**, exit 1. These two runs overlap the earlier suites and are not summed.

The five existing ZIP failures are: one `packBackupZip` test expects zero source reads at the archive limit but observes one; three 375/390/430px UI cases cannot find the expected `加密保护` switch; one encryption UI case has the same missing-control contract. No backup assertions were weakened, skipped or deleted. The QQ original-reply ZIP test successfully writes an isolated candidate database, reads the original assistant content back, validates references, and verifies the source database was not written.

During development, the direct-insert test fixture exposed `PrematureCommitError`; it was changed to use the real `queueUserMessage` entry. A cursor mock incorrectly advertised more data after EOF and was corrected. A pending-cursor recovery fixture initially lacked the legacy/backfill precondition and was corrected. A manual-menu race led to the actual empty-poll timeline fix. An environment handover interrupted the first baseline run; it was explicitly rerun to completion. None of these intermediate failures or interrupted processes are counted as passes.

## Final main synchronization and delivery boundary

Remote main advanced during the audit to `170cb5ee4550c5614d18ad18c793cf7d38cd0ace` (PR #106). Its only changed files since the starting base are `src/CharacterLifePanel.tsx` and `src/characterLifeGeneration.ts`. They are preserved verbatim when merging main **into this feature branch**, never the reverse. The audited QQ and failing ZIP baseline files did not change in that main update.

Final integrated validation after that main update: TypeScript and Production build both exit 0; portable lore parity check exits 0. The combined QQ/WeChat/life run reports **71 passed, 8 failed** (79 tests), including all **24 QQ/WeChat cases passing**. All eight failed life test IDs and assertion categories reproduce on a separate, clean, detached `170cb5e` baseline: **0 passed, 8 failed, exit 1**. They are not counted as passing or silently attributed to an environment issue:

- `character-life.spec.ts:28` (two cases): expects no persisted hostile/player-action event, receives one simulated event.
- `:88` (390/430px): waits 60 seconds for the absent exact `暂停事件` button.
- `:118`: old interrupted-claim recovery contract fails.
- `:160`: advances 90,001 ms, while current main uses a 150-second request timeout; test times out waiting for completion.
- `:243`: old exact `推进一次 / 手动恢复` label is absent.
- `:245`: manual life progression starts while the diary gate is held; current main permits that manual path, and the test times out.

The two life source files remain byte-for-byte identical to main. These are existing main/test-contract failures, left for their owning feature rather than weakening assertions or changing life business logic in a QQ repair. Logs: `/tmp/qq-merged-regression.log` and `/tmp/qq-main170-life-baseline-final.log`; the latter completed with exit 1 after the interrupted earlier attempt was rerun. Final integrated Node tests again pass **31/31** and local PostgreSQL tests **8/8**. An additional restricted-sandbox Node attempt reported a file-level failure without assertion output; the same unchanged suite rerun with subprocess/Worker permissions exits 0 (31 tests), not counted as another independent test group.

The feature branch is disabled in `vercel.json`'s existing `git.deploymentEnabled` map. Commit messages use `[skip ci]` to avoid triggering paid/unnecessary Git builds; no GitHub Actions success is claimed. There is no Production release in this task.

## Changed-file manifest

- `docs/qq-memory-context-audit-2026-11-24.md`
- `scripts/build-qq-lore.mjs`
- `src/Chat.tsx`
- `src/WechatIntegrationSettings.tsx`
- `src/chatContext.ts`
- `src/main.tsx`
- `src/qqClosedContinuity.ts`
- `src/qqContextSnapshot.ts`
- `src/qqContextSync.ts`
- `src/qqDailySync.ts`
- `src/wechatCloudIdentity.ts`
- `supabase/functions/_shared/qqContext.d.mts`
- `supabase/functions/_shared/qqContext.mjs`
- `supabase/functions/_shared/qqLorePlan.d.mts`
- `supabase/functions/_shared/qqLorePlan.mjs`
- `supabase/functions/_shared/qqReply.d.mts`
- `supabase/functions/_shared/qqReply.mjs`
- `supabase/functions/claudia-qq-ai-config/index.ts`
- `supabase/functions/claudia-qq-ai-run/index.ts`
- `supabase/functions/claudia-qq-sync/index.ts`
- `supabase/migrations/20261124000000_qq_context_continuity.sql`
- `tests/fixtures/qq-closed-continuity-c582573.txt`
- `tests/qq-baseline-reproduction.test.mjs`
- `tests/qq-context.test.mjs`
- `tests/qq-edge.test.mjs`
- `tests/qq-sync.spec.ts`
- `vercel.json`
- `workers/qq-ai-worker.mjs`
- `workers/qq-tests/database.test.mjs`

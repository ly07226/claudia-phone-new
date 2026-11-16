# Codex handoff — Memory Summary V2 (2026-11-16)

## Scope / safety
Repository: `ly07226/claudia-phone-new`
Working branch: `feature/automatic-memory-summary-v2`
Pull request: https://github.com/ly07226/claudia-phone-new/pull/62
**Do not merge to main, deploy Production/Netlify/Vercel, or trigger GitHub Actions without user authorization.** Preserve original chat history, memory records, world branches and backup compatibility. Do not use paid model APIs for tests without explicit permission. Make small, reviewable commits on this branch and report evidence.

## Current GitHub snapshot
GitHub compare `main...feature/automatic-memory-summary-v2`: **diverged**, feature ahead **161** commits and behind **41** commits, **31 changed files** as of handoff. Re-fetch current refs before doing work. In particular, do not assume this feature branch includes latest main fixes; review conflicts and integrate selectively with tests, not a blind merge.

## Implemented (code submitted; NOT proven end-to-end)
- Memory scope separation for daily/world/timeline, fork visibility, manual and auto memories, short-context and summary receipts.
- Configurable 20–100 turn primary summaries, checkpoint/resume, deduplication, source fingerprints, bounded model inputs, and failure classification.
- Secondary calendar digests (1/2/3/7/14 days), checkpointing, source verification, and context injection.
- Dedicated summary API and scheduler, cross-tab lock for daily digests, UI and tests.
- Capacity limits raised: memory revisions 20,000, total characters 10,000,000, forks 16,384, receipts 5,000. **These are only safety limits, not evidence of iPhone performance or a scalable storage design.**
- Recent fixes: attachment-aware primary fingerprint `6add945`, test `3816d80`; attachment/variant-aware daily digest fingerprint `76d7182` and context matching `4e9f279`; final transactional source recheck `a9a8b03`, empty-day race guard `a3db1fd`; digest checkpoint source binding `89c92cb`, disable unverifiable legacy checkpoint resume `a6eb074`.
- These fixes were committed via GitHub API, **not locally built or executed**. Inspect for TS errors, Dexie transaction lifetime errors, and regressions.

## P0 — legacy compatibility / migration (highest priority)
1. Legacy primary receipts without `sourceFingerprint` are skipped by `src/memorySummary.ts` snapshot, and `src/memoryContext.ts` excludes auto memories without a verifiable `sourceReceiptId`. Older data can remain physically present but vanish from AI context and may be re-summarized repeatedly. Build a safe, explicit compatibility strategy; distinguish verified vs unverified legacy data, preserve history, avoid false provenance and duplicate facts. Do not simply mark old receipts trusted.
2. Changing fingerprint payload to include attachments/variant IDs means **previously fingerprinted** primary receipts and daily digests using the old hash format now fail verification even if content is unchanged. Add a **versioned fingerprint scheme** and compatible verification of old hash versions. Existing hashes may be verified against their original schema, then upgraded only after checking current source where feasible; acknowledge inability to prove no intervening edits. Do not overwrite originals or silently invalidate all history.
3. Old daily digests and checkpoints lacking fingerprints/signatures: preserve, distinguish unverified, regenerate safely when necessary, avoid paid API loops. Verify backup import/export and data validation across schema versions.
4. Test realistic legacy fixtures: no fingerprint, old fingerprint v1, no sourceReceiptId, edited/deleted message, switched assistant variant, changed attachment, world forks, restores, and zero-result receipts. Tests must assert no loss of raw chat and no stale fact injected.

## P0 — correctness / race / transaction audit
- `src/summarySourceFingerprint.ts` uses async `crypto.subtle.digest`; `src/memorySummary.ts` computes fingerprints inside Dexie transactions (claim, snapshot, commit); `src/memoryStore.ts` `readShortMemory` also hashes inside transaction. **Check Dexie auto-commit / PrematureCommitError** and fix with sound transaction design (e.g. appropriate Dexie.waitFor or move compute out with atomic revision recheck). Do not assume safe.
- Audit `src/dailyDigest.ts` recent use of `db.transaction('rw',[...db.tables], ...)`: verify Dexie accepts this and that `nodesForHead` / `activeMessages` run inside same transaction and avoid expensive all-table locks. Ensure scope/epoch check, settings check, and source check are atomic. Avoid performance regression.
- Primary summary checkpoint writes and completion are subject to concurrent edits, branches, multi-tab races. Confirm source and job identity checks at each write, no partial auto-memory writes, and correct failure status.
- Digest source includes image attachment IDs, but raw summary prompt only includes text. Clarify expected image semantics; do not claim image interpretation.
- Ensure per-turn duplicate suppression, tombstones, manual edits, and branch isolation remain correct.

## P0/P1 — capacity, performance, backup
- At capacity, ensure no silent deletion or infinite retry; after capacity is freed or policy changed, jobs can resume. Avoid repeatedly charging APIs.
- `MemoryStore` and receipts embedded in `Conversation`; 20k revisions / 5k receipts may cause heavy cloning, validation, serialization, and prompt read. Profile iPhone-like environment and large conversation datasets. Consider compatible migration to IndexedDB sub-tables only with safe rollback/backup and migration tests.
- Audit full backup/restore, including legacy backup, checkpoints, receipts, forks, daily digests, attachment metadata.
- Check multi-tab and background interruption, API failure/timeout, abort, offline, retry and resume.
- Confirm daily vs world and cross-world scope separation and fork inheritance.

## Required validation (no GitHub Actions unless user approves)
1. Pull latest branch locally and run `npm ci`, `npm run typecheck`, `npm run build`.
2. Run targeted Playwright tests: `tests/memory-source-provenance.spec.ts`, `tests/memory-global-digest-regression.spec.ts`, `tests/memory-summary-scheduler.spec.ts`, plus existing memory/backup/timeline tests. Add missing migration and concurrency tests. Use local Playwright; do not trigger hosted Actions.
3. Verify backup restore with actual old fixtures and new backup roundtrip; inspect IndexedDB data after migration.
4. Benchmark large datasets (e.g. 10k chat messages, 20k revisions, 5k receipts), startup, typing, send, open chat, memory context, summary status; report actual numbers and environment, not guesses.
5. Check `main`'s 41 missing commits and record conflicts/required backports. Do not merge `main` into this branch until scope and tests are understood; do not rewrite history.
6. Report pass/fail and unresolved risks with commit SHAs and tests run. Only then ask user before merge/deploy.

## Suggested first actions for Codex
- `git fetch origin` then `git checkout feature/automatic-memory-summary-v2`; inspect `git log --oneline --decorate -20`, `git diff origin/main...HEAD --stat`, `git log HEAD..origin/main --oneline`.
- Start with typecheck and the changed fingerprint verification paths; fix immediate compilation/transaction errors.
- Implement backwards-compatible versioned fingerprint verification and regression fixtures before further optimization.
- Keep the PR as draft/work-in-progress; never claim tests passed without execution.

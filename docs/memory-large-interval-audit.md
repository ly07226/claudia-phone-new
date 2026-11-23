# Large-interval memory summaries: audit and local verification

Base: main 62ac57bf6c22b1925ad3dbd13f9007a74d10b072. Work is isolated on feat/memory-large-interval. No database version change, remote model requests, deployment, or user-data operations.

## Confirmed defects and changes

- `memorySummary.ts:claim`: the previous API-budget binary search reduced the selected interval itself. Claim the complete configured interval, then plan independent inputs. Presets 20/50/100/200/500 and custom 1–1000 retain legacy values such as 40.
- `memorySummaryChunks.ts`: the old 3,000-character turn projection omitted long-message tails. Cooperative planning preserves all non-redacted text, splits oversized messages without splitting surrogate pairs, and represents images by counts (not invented visual facts). Adult-detail filtering is clause based; relationship/commitment facts remain. It is a heuristic, not a semantic guarantee.
- `memorySummary.ts:execute`: the old 2,500-character digest slice lost later events. The interval digest now uses lossless local chronological reduction, source labels, conservative deduplication and explicit historical status for otherwise identical superseded statements. No additional model merge request. This does not solve all semantic contradictions or arbitrary paraphrase/state supersession.
- `memoryValidation.ts`: evidence was limited to turn 100 even after interval support expanded. A failing 500-distinct-fact end-to-end test exposed this; provenance now supports 1–1000, including ZIP validation.
- `memoryStore.ts`: bulk append checks and commits all selected memories in one transaction, instead of repeatedly cloning/validating the entire store for each fact. Source verification, scope, capacity, manual-edit and deletion protections remain.
- `memorySummaryRequest.ts`, `apiModels.ts`: use explicit model context/output metadata when available. Otherwise use a conservative 8192 context fallback. UTF-8 byte cost is a conservative proxy, NOT a tokenizer measurement. The planner reserves output and prompt overhead; it cannot discover an undocumented provider limit. Saved user limits are not increased. Errors retain only scalar usage diagnostics, never source text or keys.
- Long history source projection yields cooperatively and reuses bounded caches. Large digests are initially previewed in the memory UI; explicit expansion shows the full saved digest.

## Execution, recovery and costs

One task claims one complete source interval. Every successful, source-checked piece is persisted immediately. Truncation/input-budget failures split only the failed input. JSON syntax/root-shape failures receive bounded repair attempts. Limits: two recovery levels per piece and six recovery adjustments per task (at most twelve additional child requests). The settings explain per-piece calls and recovery costs. Network, quota, authentication and safety failures do not silently retry.

A request intent is persisted before each call. Closing/hiding the PWA aborts active work and retains completed checkpoints. Reopening requires explicit recovery of an uncertain paid attempt; exactly-once billing across a crash is not promised. Locks, renewable three-minute job/fallback leases and source fingerprints protect concurrent clicks/windows. Legacy checkpoints can resume their original smaller group without being discarded.

Final memories, digest, receipt and processed progress commit atomically. A forced database write failure rolls all of them back while preserving already-completed extraction pieces; manual recovery commits without another API request. A genuine empty candidate array is valid reviewed work and advances its receipt with zero new memories. Unsupported claims never receive manufactured sources; noncritical metadata can be recovered only from actual source evidence.

## Capacity and compatibility

No destructive migration or new Dexie version. Legacy settings/checkpoints/receipts remain readable. ZIP round-trip tests validate large receipts and evidence after turn 100 in an isolated database. New custom intervals above the old maximum are not guaranteed to be understood by a downgraded old application.

Local guards: at most 2048 planned pieces, 8 MiB projected source and 14 MiB conversation-record budget. These protect existing backup/storage envelopes; exceptionally larger intervals fail explicitly with original chat intact. Input/model-context limits alone do not reduce the selected interval. Aggregate store/receipt capacity protections still apply.

Core-memory synthesis remains an independent existing task. Very large accumulated summaries may exceed its separate context budget; this work does not claim to redesign that pipeline. No shared backend receives local chat or keys. Existing Supabase/Railway bridge workers are not safe drop-in executors for isolated IndexedDB snapshots and tenant-owned credentials. Background uploading/execution requires separate security, consent and billing design.

## Verification evidence

All API responses are local mocks routed through real execution entry points and real browser IndexedDB transactions. No paid API was invoked.

- Baseline failure reproduction: interval 200 rejected; long-message tail omitted; no truncation recovery (3 failures on original code). Separate 500-fact provenance reproduction failed before turn-bound repair.
- Final dedicated suite: 28 passed, 0 failed, exit 0. Includes presets, 1000 custom, 1083-round backlog, 200-round final receipt, 500 distinct sourced facts, truncation, bad JSON, quota, checkpoint recovery, concurrency without Web Locks, actual database rollback, ZIP, and 390/430px UI.
- Earlier combined acceptance run: 93 passed, 0 failed, exit 0 (includes 26 of those dedicated cases; counts are overlapping and must NOT be added).
- TypeScript and Production build: exit 0. Existing large-bundle warning remains.
- Sequential dedicated-run local Chromium sample, 1083 rounds with long synthetic text: summary-status cold 67.2 ms; five warm calls 56.9–69.7 ms, median 62 ms. One actual 390px form-fill during a running task: 13 ms. These are single-machine samples, not native keyboard latency, before/after proof or iPhone measurements.

Full memory/chat regression results are recorded below after the final run. Existing suite contract mismatches and real red tests must not be presented as passing.

## Unverified

Real provider output quality, undocumented tokenizer/context behavior, iPhone Safari/PWA/Chinese IME, lock-screen suspension, actual user 3728-message database, and real-world billing. The supplied screenshot confirms a length finish but does not establish input overflow, actual token usage or a provider-specific cause. Recovery reduces failed input size instead of merely increasing output caps; no claim that every provider can complete every interval.

## Full regression (final implementation)

`npm run test:memory-regression -- --workers=2`: **233 passed, 21 failed, exit 1**, 254 cases, about five minutes. The 28-case dedicated suite is included in this count; do not add it again. No tests were skipped or assertions weakened.

Red groups: five backup ZIP cases (the same five failed in the previous untouched-main baseline); three magnetic concurrency/outgoing-request cases; seven format cases; two ordinary-event quality cases; one receipt-to-prompt case; two scheduler cases; one short-summary management UI case.

Some expectations explicitly conflict with this task or current behavior (one call for a whole interval, output cap 1600, no finite truncation recovery, waiting another 40 rounds after authentication failure). Others remain genuine unresolved compatibility/behavior checks (magnetic lease recovery, outgoing tags, receipt UI, diagnostic specificity). They are NOT all declared historical or harmless without baseline evidence. Exact failing case names and stack traces were retained in `/tmp/memory-large-final-regression.log` during development. This result prevents claiming full-system acceptance or recommending automatic merge.

### Exact final red cases

```text
21 failed
    tests/backup-zip.spec.ts:16:1 › 打包超限在读取数据前停止，中断不返回半份ZIP，密码错误不能降级成未加密 ───────────────────────────
    tests/backup-zip.spec.ts:17:34 › ZIP手机流程 375px：单次保存、读回预览、确认前不替换数据及分享状态准确 ───────────────────────
    tests/backup-zip.spec.ts:17:34 › ZIP手机流程 390px：单次保存、读回预览、确认前不替换数据及分享状态准确 ───────────────────────
    tests/backup-zip.spec.ts:17:34 › ZIP手机流程 430px：单次保存、读回预览、确认前不替换数据及分享状态准确 ───────────────────────
    tests/backup-zip.spec.ts:18:1 › 加密开关只保护数据不选择Key，密码确认必需，主界面支持加密ZIP读回 ────────────────────────────
    tests/memory-magnet-concurrency.spec.ts:23:1 › interrupted claim never auto-retries; explicit recovery requires failed status 
    tests/memory-magnet-outgoing-request.spec.ts:7:54 › message-level recall reaches actual model request and removing tag stops return: openai-compatible 
    tests/memory-magnet-outgoing-request.spec.ts:7:54 › message-level recall reaches actual model request and removing tag stops return: gemini 
    tests/memory-summary-format.spec.ts:7:1 › 复现旧解析器拒绝说明包装，兼容完整JSON/围栏但保持严格逐条校验 ────────────────────
    tests/memory-summary-format.spec.ts:8:54 › 总结专用JSON参数及实际响应包装兼容 openai-compatible ───────────────
    tests/memory-summary-format.spec.ts:8:54 › 总结专用JSON参数及实际响应包装兼容 gemini ──────────────────────────
    tests/memory-summary-format.spec.ts:9:54 › API明确截断即使JSON完整也不写入、不推进进度 openai-compatible ─────────
    tests/memory-summary-format.spec.ts:9:54 › API明确截断即使JSON完整也不写入、不推进进度 gemini ────────────────────
    tests/memory-summary-format.spec.ts:10:1 › 58轮格式失败可见诊断、无私密原文，主动重试后只推进本次区间 ──────────────────────
    tests/memory-summary-format.spec.ts:12:1 › 接口拒绝结构化参数无自动回退，非法诊断字段拒绝进入备份 ─────────────────────────
    tests/memory-summary-quality.spec.ts:11:54 › 合法空结果正常推进；普通事件筛掉后零条也不反复请求 openai-compatible ───────
    tests/memory-summary-quality.spec.ts:11:54 › 合法空结果正常推进；普通事件筛掉后零条也不反复请求 gemini ──────────────────
    tests/memory-summary-receipt-return.spec.ts:7:1 › verified first-pass summary reaches prompt; edited source invalidates it 
    tests/memory-summary-scheduler.spec.ts:32:1 › automatic summary: provider 503 ends immediately, then waits another interval 
    tests/memory-summary-scheduler.spec.ts:61:1 › automatic summary: authentication error stops after one attempt and defers 
    tests/memory-v2-management.spec.ts:9:1 › 20轮自动总结真实路径更新短期UI且只调用一次，手动核心原样保护 ──────────────────────
  233 passed (5.0m)
```

### Current-main baseline confirmation

The sixteen non-backup red cases were rerun against an untouched `git archive 62ac57bf...` snapshot (only local server/fixture port changed from 5173 to 5174). **16 failed, 0 passed, exit 1**. These same cases already fail on current main; the magnetic lock failure has the same calls=1/retry=1 instead of 0/0 assertion. This does not repair or excuse those failures. Baseline log: `/tmp/memory-large-main-red-baseline.log`. They remain outside the successful large-interval acceptance proof.

Five ZIP red cases were also rerun on the same current-main archive: **5 failed, exit 1**. The unchanged-baseline assertions concern the early export-size guard, API-key checkbox/UI flows at 375/390/430px, and the encrypted-backup UI flow timeout. Together with the sixteen cases above, every final red case also reproduces on the current-main baseline. This is baseline evidence, not a claim that those behaviors are acceptable. The large-interval ZIP verification/restore tests themselves passed.

## Chat/Story regression and isolated retest

`npm run test:chat-regression -- --workers=2`: 280 passed, 4 failed, exit 1 (284 unique cases). Three failures reported execution-context destruction during navigation; the 10,000-history case timed out after 240 seconds while waiting for navigation. No source or assertions were changed. With other test servers stopped, the exact four cases were rerun with one worker: **4 passed, 0 failed, exit 0**, 32.9 seconds; the 10,000-history full traversal took 19.8 seconds. Thus all 284 unique cases have a passing result, but the original full run was NOT green. Concurrent dev-server/dependency-cache activity is a possible interference source, not a conclusively established product root cause.

## Sequential performance comparison

Same synthetic 1083-round, long-text fixture, one worker, separate local runs after other runners ended:

| implementation | status cold | five warm calls median |
| --- | ---: | ---: |
| untouched main 62ac57bf | 173.4 ms | 73.4 ms |
| current implementation | 77.9 ms | 71.1 ms |

Single-run samples only, not statistically controlled end-to-end chat-enter benchmarks. Warm samples overlap substantially; no material warm-speedup claim. Cooperative splitting, bulk writes and preview limits address particular work stages, not every remaining O(N) source-path/IndexedDB operation. Native iPhone input performance is unverified.

## Delivery boundary

Local commit only. No push: branch pushes have previously triggered Netlify previews despite skip tags, so build-cost isolation is not established. No main merge, Actions dispatch, Vercel/Netlify deployment or paid-model call. Other worktrees and generated screenshots remain untouched/uncommitted. The feature has deterministic large-interval acceptance evidence, but 21 baseline red cases plus real-device/provider limitations prevent claiming full-system acceptance or automatic merge readiness.

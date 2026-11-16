# Claudia Phone performance audit — Issue #66

## Scope and baseline

Independent worktree and branch `perf/audit-66`, based on the complete PR #64 head `1c64397f92638e2367bdcdc21bbbff7b48c5dfd0`, with current main `23162be26930e57fb7c2e072e8d28810bf9b1007` merged as `bdd8cf8ebb5d908660f5332bfe849eba7bd49b0c` before validation. This preserves main's newer punctuation-only bubbles and CSS. No schema migration, prompt/model/API changes, history deletion, main push or manual deployment. Existing worktrees and their changes were not reset or cleaned.

Issue #66, all PR #64 commits/diff/comments, and the data/render paths below were inspected. PR #64's description mentions a load button; its actual current code already uses automatic upward loading. This patch retains automatic scrolling and adds no loading UI.

## Reproduced bottlenecks and changes

| Path | Evidence and trigger | Fix |
|---|---|---|
| Immutable timeline reads | `nodesForHead` originally awaited an IndexedDB get and fingerprint for each parent; 10k path: 10k gets, 2.08s | Conversation-scoped bulk graph reads up to 20k nodes, linked-path ordering, batched fingerprints, preserved scope/cycle/content checks; larger archives retain bounded-memory original walk |
| Sending/committing | A single 10k append did 30,001 node gets and 40,002 hashes, 9.36s | Reuse already verified unchanged snapshots/fingerprints in the same transaction, batch variant reads and node writes, return validated constructed path. Transaction-local proof cache is invalidated before every Dexie path-node write; copies prevent caller mutation. No cross-transaction trust |
| Snapshot refresh | Metadata-only updates loaded all history/variants and serialized full arrays for equality | View-only cache keyed by DB/conversation/timeline/head/revision plus conservative mutation invalidation. Metadata still updates separately. Stable per-record comparisons, no full-history stringify. Visible variants have a separate bounded live query |
| Infinite DOM growth | PR64 mounts 100 initially, then 900 after eight upward scrolls; continued traversal grows without bound | Measured-height, two-way 120-message DOM window, prefix-height index, overscan and spacers, same `ChatMessage`, no fixed message height or history limit. Original arrays/storage remain complete |
| History jumps/anchors | PR64 can expand to thousands for a jump; old numeric scroll restoration can override measured anchor restoration | Quote and management jumps reveal only the target window; preserve visible message ID/offset during recycling/data changes; eliminate duplicate restoration for changed snapshots |
| Bubble work | Passing full arrays and new callbacks/metadata objects repeatedly defeats child memoization; quotes do per-row full-array searches | Stable heavy bubble view and callbacks; narrow presentation conversation props; shared message index for quote lookup; preserve all bubble parsing/DOM/menu/version behavior |
| Animation snapshot | Starting a reply serialized every assistant's full body to build animation keys | Map existing message snapshots by ID; compare content/version without serializing historical bodies |
| List previews | Each row preview previously resolved the full active timeline | Read/validate eligible tip only and conversation ownership/ancestry; legacy uses indexed reverse latest-message read. Full generation/history reads still validate the entire selected path. A preview is explicitly not a full integrity audit |
| Keyboard closing transition | After blur the existing code kept `keyboard=true` but immediately discarded `visualViewport.offsetTop`. Waiting two animation frames makes the unoptimized baseline fail: expected footer bottom 457, actual 410. The original test could sample before the scheduled resize and falsely pass | Preserve the current viewport offset while keyboard geometry is still confirmed reduced. One boolean condition, no pixel adjustment; strengthen the existing test to wait for the layout frames, with its exact assertion unchanged |
| Global assets/reloads | `usePhone.reload()` loaded every historical chat photo into shared state, even outside chat | Load presentation assets plus actually referenced chat-image avatars/backgrounds/covers/drafts; mounted message/post photos keep existing lazy DB reads. No asset deletion. Keep unchanged store arrays/records and suppress no-op notifications; release the component snapshot and selected DOM references when leaving a conversation |

Implementation: `chatViewport.ts` (one closing-transition condition), `loreEngine.ts` (diagnostic label only), `Chat.tsx`, `MessageUI.tsx`, `messageReferences.ts`, `timelines.ts`, `chatListPreview.ts`, `store.ts`; new `useChatHistoryWindow.ts`, `historyLayout.ts`, `chatDataRevision.ts`, `dataEqual.ts`, `presentationAssets.ts`.

## Actual measurements

Synthetic isolated databases, Chromium with the project's iPhone 13 viewport/device settings, local Vite development build, same fixture and host. Baseline = `bdd8cf8`; optimized run single worker. These are single observed runs, not medians, production throughput, or real iPhone measurements. No paid API was called. Timing assertions are deliberately not used as flaky correctness gates.

| Messages | Full path before → after (ms) | Local append before → after (ms) | Open conversation before → after (ms) | DOM after 8 upward scrolls before → after |
|---:|---:|---:|---:|---:|
|100|34.5 → 10.6|108.7 → 20.3|214 → 161|100 → 100|
|1,000|232.4 → 63.2|1,073.8 → 132.0|869 → 249|900 → 120|
|10,000|2,082.8 → 485.2|9,356 → 883.0|4,373 → 909|900 → 120|

Database counters: baseline append `3N+1` node gets/`4N+2` hashes; optimized scoped path `0` individual node gets/`N+1` hashes (plus bulk/index queries). Hashes for new independent full reads remain N: integrity was not removed. Current full-path loading still costs O(N).

Ten-character webdriver typing: baseline 124/65/76ms; optimized 102/129/84ms at 100/1k/10k. **No reliable typing-speed improvement is established.** PR64 already memoized typing's heavy JSX. Entry metrics exclude fixture creation and some list-preview startup; append metrics are local persistence, not model latency. Heap, battery, compositor and real device frame-time were not reliably measured; no fabricated memory/FPS claims.

Full 10k-history traversal asserts every message ID is visited, mounted rows stay ≤120, draft remains unchanged, stored messages/node counts remain unchanged. Custom style/history jump/edit/delete/branch tests exercise actual DB and UI, not replacement history components.

## Whole-project audit and remaining costs

Production build still bundles about 1.35MB of JS (about 466KB gzip), plus the large default leopard image (~1.39MB). This startup/network cost was identified but not hidden behind a larger chunk-size-warning limit or risky global route rewrite. Code splitting requires separate cold-start and navigation validation.

- `Worlds.tsx`/settings/desktop consume global `usePhone`. Stabilizing reloads and excluding unused historical photo payloads reduces shared churn, but worlds/source documents, characters and all non-chat-image assets remain eagerly loaded. Very large libraries are not proven constant-cost.
- `StoryReader.tsx` initially slices 12 entries, then expands upward without recycling. Long Story histories can still grow DOM. `storyContext.ts` rebuilds history/index and serializes several budget candidates during generation. These are distinct from chat keystrokes; no prompt, memory or reader rewrite was made without dedicated performance evidence.
- Backup export already streams records to temporary parts (`backupService.ts`) and bounds ZIP chunks (256KiB). `backupZip.ts` still disables workers/CompressionStream and caps archives/unpacked bytes at 32MiB; compression/encryption may block the main thread and large records/Blobs still consume memory. No format/security limits were removed to report false success. Dedicated worker/Safari benchmarking is future work.
- Chat/Hub share the existing viewport scheduler and suppress identical geometry writes. The only viewport change preserves the actual offset during a confirmed keyboard-closing transition; it does not change configured heights, safe-area rules or navigation visuals. Input auto-sizing still reads scrollHeight. Real iOS standalone compositor/keyboard/white-flash behavior cannot be proven by Chromium tests.
- Images already load through mounted `StoredImage`/`MessageImages`. The new global asset filter preserves legacy references to chat-image resources as avatars/covers/backgrounds; all unmounted image bytes remain in IndexedDB and backup.
- Existing PhasePlay timers/foreground pause and small session persistence were inspected; no library rewrite per beat was introduced or changed. Social task/API/background scheduling remains unchanged.
- The 20k-node bulk cutoff bounds row count, not byte count. Very large individual messages and heavily branched archives remain costly; above the cutoff integrity reads use the slower original parent walk. A single giant response with many bubbles is still fully mounted as one message group.
- Custom CSS uses the same supported theme selectors/classes and message DOM. Windowing means offscreen DOM is absent; unsupported arbitrary whole-history structural selectors cannot be promised. Built-in theme spacing, bubbles, gradients/shadows/pseudo-elements are regression-tested. Width changes use estimated offscreen heights until measured; scrollbar geometry is approximate, while visible anchors are preserved.
- Cross-tab table changes conservatively invalidate the view cache. This is not an authoritative global data cache. Transaction integrity cache lives only within a single transaction, with an 8Mi-content-character cache threshold (other record fields have additional overhead) and invalidation on path writes. Backup/full-history verification is not bypassed.

## Validation and limits

The final frozen-code sequence executed:

| Command / family | Passed | Failed | Result |
|---|---:|---:|---|
| `npm run test:chat-regression -- --workers=2` |281|0|Includes 11 new functional history/assets cases; added to the existing CI script without changing or manually dispatching workflows|
| Cross-module 20-file selection: chat time/actions/images/settings, keyboard, Hub layouts/social, all themes, backups, settings navigation, initial/bottom/PWA viewport |223|11|Exact remaining failures listed below|
| Other 13-file selection: PhasePlay, API config/selection/models, Story reading/cards/settings and world-input layouts |118|1|Old migration fixture expects no newly seeded app icons|
| `npm run test:performance` (one worker) |17|0|11 functional cases overlap the core run; six measurement cases are additional|
| `npm run typecheck` |—|0|Exit 0|
| `npm run build` |—|0|Exit 0; large-chunk warning remains visible|

These are 640 distinct selected test cases (628 pass, 12 fail), not a claim that the repository's entire default `npm test` suite ran. WebKit was not executable, and real iPhone testing was not performed. Raw metric observations are committed in [performance-audit-66-metrics.json](performance-audit-66-metrics.json).

Remaining inherited failures (not hidden or weakened):

- `chat-hub-polish.spec.ts`: publishing/automatic comment round limit; failure/zero API case; serial consecutive posts (3 cases). The fixture's single-participant request counts conflict with existing multi-character comments.
- `chat-hub.spec.ts`: local cover/post/comment persistence and automatic task/lease case (2 cases), same pre-existing participant/count assumptions.
- `chat-settings.spec.ts`: 375/390/430px background persistence (3 cases), expects `background-size:cover, cover` on `.chat-app`; current main paints the image via `::before`.
- `theme-chat-acceptance.spec.ts`: custom image/background priority at 390/430px (2 cases), same old root-background assertion.
- `theme-core.spec.ts`: CSS rejection table (1 case), expects 12px and normalized `!important` to be rejected despite current main supporting them.
- `api.spec.ts:196`: old migration equality (1 case); current main seeds Memory/PhasePlay icons, while the fixture expects only the original Settings icon. Original worlds/characters/themes/assets and the old item remain; this patch changes no migration.

The five social cases, 375px background case, 390px priority case, CSS rejection case and migration case were individually reproduced on pristine tracked baseline code. Other widths were classified by the same assertion/source, not separately rerun on baseline. Do not misrepresent that as twelve independent baseline runs. The standalone PWA failure was separately reproduced after two animation frames on unmodified baseline (457 expected, 410 observed), then fixed; all 16 PWA cases pass in the final selected suite.

`settings-navigation.spec.ts` and backup UI tests now locate real desktop pages instead of assuming all icons are on page 1. Navigation/data preservation assertions remain. The punctuation fixture now explicitly expects the already-supported standalone punctuation bubble and still asserts exact concatenated raw text and no whitespace-only bubbles. The diagnostic fixture now separately verifies mandatory and optional worldbook rules; production injection behavior is unchanged, only the incorrect skip reason was fixed.

Because the twelve inherited assertions remain unresolved, **this PR is draft and is not certified for merge**. No failing tests were deleted, skipped or changed merely to reduce counts.


Development failures are not hidden: a preparation script twice targeted the isolated baseline worktree instead of the audit worktree; its tracked files were restored from its own HEAD, the diff was checked empty and affected runs were discarded and repeated. No pre-existing user worktree was overwritten. Other failures: the first fixture omitted continuous-send mode (fixed fixture); an initial browser start was blocked by sandbox port permissions (rerun with local server permission); one message-menu run navigated after Vite hot updates while test files were being edited (stable rerun passed); new test expectations initially used truncating `removeMessage` instead of the UI's local `deleteBubble`, and tried tampering an inactive old-branch head (corrected fixtures to the actual active path). No production business assertion was weakened or removed.

No real private database, API credential or chat content was used. WebKit executable was present but could not start: missing libgtk-4, graphene, harfbuzz-icu, manette, hyphen and GLESv2. Installing dependencies required unavailable root authentication, so WebKit tests were not executed. Chromium device/display-mode simulations are not Safari engine or physical-device tests.

No real model, physical iPhone Safari/PWA, memory pressure/OS termination, 10k individually large images, or unbounded-history guarantee has been tested. Obtain real-device acceptance before merging: 390/430px Safari and home-screen PWA, cold/warm entry, sustained typing while saving, slow image decoding, up/down continuous scroll, quote/search jumps, branches/versions/edit/delete, repeated keyboard/candidate-bar open-close, background/resume, complex saved CSS, backup to Files.

This is a substantial verified improvement, **not** a claim that all scale-dependent work or all UI/device issues are solved. Main and Production are deliberately unchanged.

## File manifest

Runtime changes: `src/Chat.tsx`, `src/MessageUI.tsx`, `src/chatListPreview.ts`, `src/chatViewport.ts`, `src/loreEngine.ts`, `src/messageReferences.ts`, `src/store.ts`, `src/timelines.ts`; new `src/chatDataRevision.ts`, `src/dataEqual.ts`, `src/historyLayout.ts`, `src/presentationAssets.ts`, `src/useChatHistoryWindow.ts`.

Tests: new `tests/chat-history-window.spec.ts`, `tests/performanceFixture.ts`, `tests/performance-audit.spec.ts`, `tests/performance-render.spec.ts`, `tests/presentation-assets.spec.ts`; updates to `tests/bubbles.spec.ts`, `tests/request-diagnostics.spec.ts`, `tests/backup-export-diagnostics.spec.ts`, `tests/backup-zip.spec.ts`, `tests/backups.spec.ts`, `tests/settings-navigation.spec.ts`, `tests/pwa-viewport.spec.ts`.

Reproducible runner: `package.json`. Report and raw measurements: `docs/performance-audit-66.md`, `docs/performance-audit-66-metrics.json`. The follow-up PR also retains PR #64's existing `tests/chat-time.spec.ts` change; it is not a new optimization in this commit. Generated screenshots, build outputs, browser files and node_modules are not committed.

## Review / next work

1. Review the verified hot-path/window/PWA fixes and the complete test matrix; keep this PR unmerged until inherited assertions are reconciled with approved current behavior.
2. Obtain physical iPhone cold-entry, sustained typing, keyboard, slow-image and scroll acceptance. Investigate any new issue from measured evidence rather than Chromium geometry alone.
3. Profile long, heavily branched conversations, very large single messages and many versions per message. Consider indexed/streamed path loading and bounded variant neighbors only with compatibility/operation tests; current patches do not claim constant-time sends or bounded total history memory.
4. Separately benchmark worker-based backup compression and route-level code splitting with iOS compatibility. Preserve all archive data and formats.

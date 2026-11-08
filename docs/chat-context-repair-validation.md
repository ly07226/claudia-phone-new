# Chat context repair: isolated validation

Branch: `fix/chat-memory-context-diagnostics`. No production deployment is part of this change.

## Changed behavior

- Core memories are ranked first without requiring a query match. The existing budgets still apply.
- Long memories require at least one match from the existing local word/bigram scorer against the pending user input (or latest user input).
- A memory fact is injected whole, or omitted. Neither its prefix nor a generated summary substitutes for the fact. The stored record and its revisions remain unchanged.
- Existing limits remain: 2,000 conservative UTF-8 byte tokens for the complete memory block, 640 per entry, 12 entries. Oversized core facts can therefore also be omitted. Metadata reports budget omissions separately from irrelevant long memories.
- Lexical matching is deliberately conservative; it is not semantic retrieval and can miss synonyms or match incidental shared words. Tests do not establish naturalness of model replies.

## Reproducible local checks (no model charges)

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm run test:chat-regression -- --workers=2 --output=/tmp/claudia-context-review-results
npm run build
```

The suite uses synthetic fixtures and intercepted or in-memory Mock APIs. It covers memory completeness, unchanged stored memory, persona/system prompt contracts, latest user intent, selected reply variants, branch switching, Daily/World/Story isolation, lore scope/trigger/budgets, provider conversion, and response attribution. GitHub Actions runs the same script, type check and build with read-only repository permissions; it receives no model credentials.

Use a cold Vite server after code edits. Tests importing `/src/module.ts` can otherwise see a different in-memory singleton from application imports containing an HMR `?t=` suffix. Do not change generation logic to accommodate this development-only split.

## Independent preview

Use a new browser profile and a separate local origin, not the production PWA:

```sh
npm run preview -- --host 127.0.0.1 --port 4175
```

Open `http://127.0.0.1:4175/?requestDebug=1`. This origin has separate IndexedDB and settings from production. Do not import a private database or API credentials for Mock validation. For interactive seeded fixtures, the browser tests start Vite on port 5173 and assign random database names. The diagnostics UI is also tested at 390px.

For an eventual iPhone preview, use an explicitly approved, separate HTTPS preview deployment after review, with disposable synthetic data and Mock transport. No such deployment is created here. A production Service Worker is not a valid preview of this branch. Native keyboard and real model behavior still need separate acceptance; automated tests do not validate those.

## Optional request diagnostics

Add `?requestDebug=1` before the URL hash, then open the chat or Story app. It is off without the exact parameter. A fixed, initially collapsed panel shows the latest request; **Copy redacted diagnostics** exports up to 20 requests. No automatic upload, console logging, database/localStorage write, or paid analysis request occurs.

The report contains only ephemeral sequence numbers, relative timestamps, mode, source categories and lengths, history counts, insertion roles/positions, scope categories, trigger/skip decisions, duplicate-content references, budget counts, provider roles, fallback attempts, and response format flags. It does not include names, message/memory text, keys, raw errors, URLs, model names, hashes, or persistent user IDs. Source/decision caps are explicit. Refresh discards the buffer.

`abcdLabels` (0–4) and `choiceProtocolHint` are **heuristics**, not proof of an instruction. JSON-escaped memory lines are inspected only for metadata. Nothing removes ABCD from inputs or outputs.

- A `story-instruction` source should only appear under `mode=story`.
- A `lore`, `memory`, `history` or `world` source showing option markers identifies a possible input source, not necessarily the first origin of the behavior. History can contain a previous model output.
- If all input sources are clean but the response shows four labels, classify that Mock reproduction as model-originated formatting; do not claim the real incident has the same origin without its diagnostic record.
- Duplicate content is reported without deduplication: identical lore placed in different roles or positions can be intentional.
- Lore skips distinguish scope, disabled, keyword/secondary miss, probability, book budget and context budget. Existing lore trigger and placement behavior is unchanged.

Keep the panel collapsed while reproducing keyboard behavior. It does not autofocus; clicking its buttons is still an explicit interaction and is not an observation of the user's system-keyboard dismissal. The diagnostic buffer is tab-local, and exported metadata cannot establish exact semantic contradictions or model intent without user-controlled inspection of the original local sources.

## Outstanding real-incident evidence

The original World ABCD incident and OOC behavior are not yet attributed to a unique source. No Story-to-World rule transfer was found in clean synthetic requests. Do not clear memories, rewrite personas, strip options, or change mode routing on that basis. After an independent preview is approved, collect the opted-in source/response metadata from one reproduction and inspect only the identified local sources with user permission.

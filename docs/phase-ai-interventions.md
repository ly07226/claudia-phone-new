# AI live intervention Preview

Branch: `feat/phase-ai-intervention`. Production baseline: `b728cd34b523dbf5dff034ed35e95a92e564359a`. Preview only; do not merge without acceptance.

## Using the feature

Open 忍一下嘛 → 其他 → AI 临场干预. The switch is off by default. Select an existing character and optionally their bound world, then explicitly press 准备新一局事件（1次 API 请求）. Start normally. Preparation is optional; failed/missing preparation never prevents play. New preparation results are for a new game, not a replacement for an already running game's pool.

Each click requests four candidates once through the existing Provider, selected character API binding or existing global default, using the saved model/parameters/key. Role name, persona, speaking style, selected world background/rules/profile, Sweet/Dirty/default and tone intensity form the context. No chat history, chat memories, other-world profiles, Story records, original instruction cards or instruction histories are read into this request. No message or memory writes occur.

There is no API request on switch-on, game start, notification, resume, refresh or game restart. Cached candidates can be reused for later games at no extra request. A deliberate new preparation costs another single request. No automatic retry or role fallback; timeout is 45 seconds. Configured output limits below 512 tokens are reported before requesting rather than overridden or split into additional calls. Cancellation cannot guarantee the upstream has not charged a request already sent.

## Local execution

Only four event types are accepted. Unknown JSON fields, wrong flavor, incomplete sets, invalid parameters and credential echoes are rejected without overwriting the prior pool. No raw provider error or generated JSON is put in the UI or logs.

- Green extension: +5–15 whole seconds, only during green, capped by the remaining game time and the existing 600-second phase bound. Neither game time nor duration settings increase.
- Tempo: actual change of 5–10 BPM; effective BPM stays within 30–180. The session stores a BPM offset, leaving the user's base/automatic-ramp settings intact. Manual tempo buttons use current effective BPM, clear the offset and retain their existing manual override behavior.
- Next phase: one pending override, consumed by the same existing automatic/manual next-stage function. It does not change the current phase and is ignored/cleared when disabled or finished.

Beat progress accumulates from the integral of the effective clamped BPM over each active interval. Changing BPM does not recompute past beats. Audio and light still share the same beat event; red, pause and stop keep their existing feedback rules.

At most two events per game; first opportunity is 30–60 active seconds, second at least 90 active seconds later, with bounded jitter and at least 15 seconds before the deadline. Short games may have one opportunity. Ineligible candidates wait for legal conditions; adjacent executed events cannot share the same type. Wall-clock/background time never catches up into events. Pause/exit remain higher priority.

Effect and executed IDs are saved atomically to the app's existing localStorage v1 record before displaying the notice. Failed saves pause without applying the event. Refresh resumes paused with already-used IDs, rather than replaying them. All new fields are optional; no Dexie version, backup format or original instruction text is changed. Existing Phase Play localStorage is still outside the existing ZIP backup coverage.

## Presentation

The notification is a fixed body portal anchored to the app's visible scroll area, with safe-area bounds and pointer-events disabled. It fades over 2.5 seconds and is unmounted. It adds no flow node, spacer or positioning rule to the existing game. Existing phasePlay.css remains byte-identical to main. 390px/430px compiled comparisons confirm the same bounds for 11 existing game elements with the feature off, and before/after a notification.

## Validation and limits

- 81 Phase Play tests, including 25 intervention cases; 226 existing chat/Story/memory/Provider regressions: 307 pass, zero final failures.
- TypeScript and Production build pass. Mock APIs only; no paid model request or real credential used.
- The existing character instruction generator is unchanged; it is not being claimed as user-accepted.
- Actual model personality/style quality, real iPhone audio and standalone behavior require user testing. Cached text is a snapshot: prepare again after changing role/world text if fresh wording is desired.
- Preview has separate browser storage from Production. No production data or keys are automatically copied. Existing Vercel Preview access protection is preserved.
- Commit and PR use Netlify's documented `[skip netlify]` marker, avoiding Netlify deploys without changing its configuration or skipping GitHub CI.

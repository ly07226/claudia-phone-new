# Automatic memory extraction closed-loop audit

Base: `c44e805` (main at branch creation). Branch: `fix/memory-extraction-closed-loop`.
All requests in validation use synthetic responses and isolated IndexedDB; no user API or user database was accessed. No schema version change.

## Confirmed blockers and remedies

| Location | Trigger and evidence | Remedy |
|---|---|---|
| memorySummaryFormat.ts / recoverSummaryBatch | A 40-turn actual execution read all messages but a cited preference without category was classified as continuity, filtered as weak-impact, and progress advanced with zero stored memories. Baseline positive tests failed. | Infer noncritical quality metadata from candidate; preserve category/importance/durability/impact/evidence. Cite actual source; quality review still applies. |
| memorySummaryFormat.ts | Double-escaped Unicode/whitespace/numeric regexes broke Chinese source recovery. Root facts/arrays and singleton nested evidence were unsupported. | Correct regexes; bounded per-candidate normalization; wrong explicit evidence is never replaced with guessed evidence. |
| memorySummaryQuality.ts | A citation in a split message could lose preceding conditional context. | Review split-message evidence against the same claimed full original message. No extra API input or alternate projection. |
| memorySummaryRequest.ts | Reasoning-only, blank body, explicit refusal and Responses incomplete end reasons collapsed into response-shape or could miss truncation. Four baseline negative tests failed. | Classify each confirmed stage; reject incomplete/refused output even if embedded JSON is syntactically valid. Preserve HTTP failure status when envelope is non-JSON. |
| memorySummary.ts / memorySummaryRequest.ts | Chunk allocation used a shorter instruction than the real request; configured output limit was replaced with 4096. | One shared actual extraction instruction for budget and request; output limit min(user config, summary safety limit). |
| memorySummary.ts / summarySourceFingerprint.ts | Interrupted partial assistant output could count as completed. Expired running task could be automatically requested again. | Preserve partial messages but exclude from completed source groups; require explicit manual recovery for expired tasks. |
| memorySummary.ts | Completed checkpoints bypassed current evidence review; incompatible checkpoint replacement discarded completed local results. | Revalidate locally without repeated API calls; retain bounded archived checkpoints, refuse before API if archive capacity exhausted. |
| memoryStore.ts / memoryTypes.ts / memoryValidation.ts | Structured quality metadata disappeared after selection. | Preserve optional type/quality and actual group-local source turns in stored revisions; validate during backup/restore; old entries without metadata remain supported. |
| MemorySummarySettings.tsx | Pending counters did not distinguish source read from extraction/save, and backlog manual action handled one group only. | Show safe source counts and fragment counts; explicit cost-confirmed bounded catch-up; stop at first failure. |

## Truth and progress contracts

- One authoritative selected immutable timeline supplies claim, request source, verification and commit. UI navigation alone cannot invalidate a batch. Append-only new rounds do not invalidate an unchanged captured prefix.
- Edit/regeneration/branch/epoch changes still invalidate affected source. Receipts and original history are preserved.
- Missing format metadata is recoverable. Incorrect quotes, speaker, negation, conditions, unsupported numbers, plan-as-fact and source mismatch remain rejection conditions.
- Invalid candidates are counted individually. A wholly ungroundable/malformed response fails; a valid empty array, or grounded candidates rejected for no durable value, may commit a zero-addition receipt.
- Memory writes and receipt/progress are one Dexie transaction. Capacity failure or transaction abort cannot mark the batch completed. Successful checkpoint fragments remain available for explicit retry.
- Repeated identical memories are skipped; manual revisions and tombstones are not overwritten by extraction.
- First-pass commit remains independent of existing second-pass core synthesis. A five-source core attempt may fail without rolling back first-pass receipt. This change does not replace the core architecture.
- No arbitrary paraphrase verifier can prove semantic truth. Local matching is conservative and cannot establish every implied relation, pronoun reference or fabricated causal claim. Real-model quality remains unverified.

## Compatibility and recovery

No database version/schema migration, no clearing existing receipts, 478 pending rounds, messages, memories or settings. Optional metadata and checkpoint archives use the current conversation record; merge-import remaps archived message/timeline/scope references. Old unchecked summaries stay retained and visibly unverified rather than being silently injected or billed for regeneration.

Manual catch-up may issue multiple bounded requests and an independent existing core request; UI asks about API cost first. There is no silent retry. A request interrupted after remote billing may still cost money; explicit recovery explains that risk. Archive capacity stops safely rather than dropping results.

## Validation record

See final delivery for exact completed commands, exit codes and remaining failures. Baseline main memory-summary suite: 8 passed / 8 failed; legacy mocks detected extraction solely through removed response_format/schema options and asserted obsolete 1600 output tokens and one input chunk. Tests now identify the actual extraction prompt and assert exact per-job chunk counts, budgets and unchanged no-retry/rollback/isolation behavior. This is separate from real code fixes.

Verified in isolated real IndexedDB: 40 rounds complete, source payload equals original 80 messages, stored quality-backed memory, one receipt, pending zero, repeat zero requests. 100 and 478 rounds: exact ceil(rounds/40) receipts, duplicate fact stored once, pending zero, refresh preserves progress, all original messages unchanged. These are Mock provider tests, not real iPhone / paid-provider acceptance.

Additional baseline verification: unchanged main memory-context + memory-integrity suite had the same five missing-tag failures (7 passed / 5 failed). Current main intentionally requires persisted magnetic tags for long-term relevance. Positive test fixtures now save scoped tags before expecting recall; negative untagged/empty-query assertions remain or were strengthened. Runtime recall rules were not weakened. Extracted long memories are persisted and have receipt digests, but tag-only magnetic recall still depends on the existing tagging workflow; this change does not silently call another model to create tags.

Two further confirmed recovery blockers were fixed: capacity recovery was checked after requiresManualResume in both claim and scheduler, so freeing capacity never reopened the task; expired running state was not closed when enabled was false. Neither remedy retries an already-issued failed provider call automatically.

A transaction-failure injection initially hit pre-request initialization instead of the commit under test; the hook was corrected to target nonempty memory-entry changes. Final focused reproduction passed: commit abort preserves zero entries/receipts, full pending count and completed checkpoint; refresh + explicit recovery writes one entry/receipt with no new API requests. This was a test injection correction, not ignored production failure.

## Rule classification (A / B / C)

- A, retained: selected timeline/epoch/owner checks; exact or formatting-equivalent source location; every supplied citation must be valid; speaker, negation, condition, numeric detail and plan/fact checks; soft-delete/manual protection; atomic receipt+entry commit; capacity and output-completion checks.
- B, recoverable: missing noncritical category/importance/durability/impact, missing citations when the candidate can be strongly matched to real source, array/facts envelopes, top-level/nested singleton citations, compatible text envelopes, punctuation/whitespace normalization. Formatting recovery stores an actual contiguous source substring, never a rewritten quotation.
- C, unified: allocation and request instructions share the same prompt; checkpoint review uses the claimed original snapshot, not a divergent UI representation; old missing statistics are rebuilt from actually preserved and locally reverified candidates rather than causing a whole retry. The pre-existing main correction removing a redundant timeline projection comparison was retained, not claimed as a new fix.

Three additional failing reproductions were established before correction: old checkpoints missing statistics could not complete; punctuation-only citation differences were wrongly rejected; one real plus one fabricated citation could be reduced to the real citation and incorrectly admit an added assertion. All now have execution-entry tests. Each supplied citation is checked, and a bad candidate cannot discard a different valid candidate.

Successful jobs now retain completedChunks instead of overwriting it with the initial zero. UI does not pretend an old job had 0/0 fragments or promise recovery after a fixed 90 seconds: the actual bounded lease must expire. Legacy missing-stat checkpoints can resume with no paid request after refresh; no new facts are inferred from an unchecked old prose digest.

Capacity recovery is automatic only for a recorded zero-chunk pre-request block with no completed paid fragments. A post-request capacity failure remains paused; explicit recovery uses its verified checkpoint without repeating API calls. Unknown legacy attempt states also stay manual.

## Final additional findings

- Numeric verification/deduplication dropped signed amounts. Baseline execution accepted a negative income as positive; a separately tested wrong amount was filtered but still advanced the whole batch. Numeric signs/percentages now survive comparison and duplicate keys. An entirely ungrounded/contradictory batch fails without receipt progress; only legitimate empty arrays or grounded candidates with merely temporary/low-value/weak-impact exclusions complete as zero-result batches. Mixed batches still retain valid candidates. A manual recovery may regenerate an invalid old fragment; verified fragments do not incur another request.
- Core synthesis had an unbounded fetch and configuration lookup outside its recorded attempt/catch. Two failing execution tests reproduced a running task with no timeout and a missing failure status. Core attempts now record configuration failures and have a 120-second response deadline/abort; first-pass receipts stay committed, failures stay visible and do not retry automatically. Existing five-receipt source verification in memoryContext is retained.
- Citation formatting recovery ignores only ordinary formatting punctuation/whitespace, not arbitrary symbols or numeric signs.

## Final executable results

| Command / scope | Exit | Actual result |
|---|---:|---|
| `npm run typecheck` | 0 | Current complete source passes |
| `npm run build` | 0 | Production build passes; existing >500 kB chunk warnings remain |
| Frozen closed-loop / quality / scope / store / backup / compatibility / mobile / shared-request suite below | 0 | 117 passed, 0 failed (3.1 minutes) |
| Additional execution-entry network + primary-timeout tests | 0 | 2 passed, 0 failed; no overlap with the preceding 117 |
| Existing `npm run test:chat-regression -- --workers=1` | 1 initially | 282 passed, 2 old missing-tag fixture failures; both reproduced on untouched main. Fixtures corrected without changing runtime recall or assertions; all 9 tests in that file passed in the final 117 suite. The full 284 were not repeated unnecessarily. |
| 478-turn unchanged-code trace repeat | 0 | 3 repeated runs passed; repetitions are NOT additional distinct test cases |

An earlier 113-test run had 112 passes and one execution-context-destroyed error during 478-turn processing, before result assertions; the page had navigated. Its precise navigation origin was not established. Error/context records were preserved locally, unchanged-code trace repeats passed 3/3, and the final standalone 117 suite passed. No timeout/expectation was relaxed and no test was skipped. This does not prove real iOS lifecycle stability.

Final main suite command:

```sh
npx playwright test tests/memory-loop.spec.ts tests/memory-summary.spec.ts tests/memory-summary-quality.spec.ts tests/memory-evidence-pipeline.spec.ts tests/memory-v2-concurrency.spec.ts tests/memory-v2-compatibility.spec.ts tests/memory-v2-backup.spec.ts tests/memory-v2-mobile.spec.ts tests/memory-store.spec.ts tests/memory-context.spec.ts tests/memory-integrity.spec.ts tests/memory-extraction-review.spec.ts tests/memory-source-provenance.spec.ts tests/chat-context-regression.spec.ts --workers=1 --trace=retain-on-failure
```

The final two network/timeout cases were added afterward and run separately with `npx playwright test tests/memory-loop.spec.ts -g '一级请求异常' --workers=1 --trace=retain-on-failure`. No runtime source changed after the 117 run.

### Database acceptance evidence

- 40 rounds: exact original 80 message texts reached model input in order; one grounded preference persisted with structured metadata and source receipt; pending 0, receipt 1; duplicate invocation issued zero additional API calls.
- 100-round setting: exact 200 original texts reached the bounded requests; one logical receipt, pending 0; configured 3000 output tokens honored.
- 478 rounds at interval 40: 12 logical receipts, pending 0; repeated synthetic preference stored once; all 956 original messages unchanged; refresh preserved progress and did not request already completed work again.
- DB exception: no partial memory/receipt, pending remains 40; current and legacy missing-stat checkpoints resume after refresh without extra API calls.
- Wrong facts/signs, explicit refusal, reasoning-only, empty body, truncated response, network and timeout: no memory/receipt advancement and no unattended retry.
- Core HTTP/configuration/timeout failure: 5 successful primary receipts remain, pending 0, failed core status visible, no automatic duplicate call.
- Normal and encrypted backups, ZIP overwrite/merge, retired source paths, 5000 legacy receipt validations and 390/430 simulated mobile layouts passed in the scoped suite.

## Remaining limits / release decision

No real paid Provider, real user backup, or physical iPhone Safari/PWA was accessed. Mock success does not prove model factual accuracy or real device process-kill behavior. Conservative source/condition/number checks cannot prove arbitrary paraphrases, causal claims or pronoun reference; some uncertain candidates will be refused. Full repository `npm test` was not executed; commands and initial failures above are the actual record, not a claim that every repository test passed.

Magnetic recall still follows main's persisted-tag policy: this repair does not add a hidden tagging API call or pretend untagged old entries have semantic tags. Archived incompatible checkpoints are retained/exported (up to three); hitting that bound stops before API rather than deleting results. The existing browser lease may require waiting before explicit interrupted-task recovery. Large real image-heavy databases remain unmeasured.

Local deterministic extraction → verification → IndexedDB commit → receipt/progress → recovery acceptance passes. Keep the PR draft for review and real-device/provider acceptance. Do not merge main or deploy Production as part of this task. Commit includes `[skip ci]` to respect the no-Actions constraint.

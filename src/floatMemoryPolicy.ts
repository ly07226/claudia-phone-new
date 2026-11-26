/** Float-derived automatic memory policy for Claudia's replacement engine.
 * Upstream reference: POPCORNqy/float-android/lib/memory-types.ts,
 * lib/chat-engine.ts, lib/memory-summarizer.ts (AGPL-3.0).
 * This module is deliberately independent of Float's Android/Capacitor storage.
 */
export const FLOAT_MEMORY_EVENT_INTERVAL = 80;
export const FLOAT_EVENTS_PER_COMPLETED_TURN = 2;
export const FLOAT_MEMORY_DEFAULT_TURNS = FLOAT_MEMORY_EVENT_INTERVAL / FLOAT_EVENTS_PER_COMPLETED_TURN;

export interface FloatMemoryProgress {
  eventCount: number;
  lastSummarizedAt?: string;
  running?: boolean;
}

/** Every completed user+assistant exchange counts as two source events. */
export function recordCompletedTurn(progress: FloatMemoryProgress): FloatMemoryProgress {
  return {...progress, eventCount: Math.max(0, progress.eventCount) + FLOAT_EVENTS_PER_COMPLETED_TURN};
}

/** Summary is automatic by default, but never runs concurrently per character. */
export function shouldSummarize(progress: FloatMemoryProgress, enabled = true, interval = FLOAT_MEMORY_EVENT_INTERVAL): boolean {
  return enabled && !progress.running && progress.eventCount >= interval;
}

/** Advance only after the summary and extracted events have been durably saved. */
export function markSummaryCommitted(progress: FloatMemoryProgress, throughTimestamp: string): FloatMemoryProgress {
  return {eventCount: 0, lastSummarizedAt: throughTimestamp, running: false};
}

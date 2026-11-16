/** Strip standalone internal timestamp metadata leaked into assistant replies.
 * Stored history is not mutated; only request copies and new output are cleaned.
 */
const LEAKED_TIME_LINE = /^[ \t]*\[消息发送时间：[ \t]*\d{4}-\d{1,2}-\d{1,2},?[ \t]+\d{1,2}:\d{2}(?::\d{2})?\][ \t]*(?:\r?\n|$)/gm;
export function stripLeakedTimeMarkers(text: string): string {
  return text.replace(LEAKED_TIME_LINE, '');
}

/** Exact single-bubble metadata marker. No ordinary dates or quoted prose are hidden. */
export function isLeakedTimeMarkerBubble(text: string): boolean {
  return text.trim().length > 0 && stripLeakedTimeMarkers(text.trim()) === '';
}

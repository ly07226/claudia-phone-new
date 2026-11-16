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

/** Return source offsets of visible spans after omitting exact metadata lines.
 * Offsets are relative to the supplied text; callers keep original message offsets.
 */
export function visibleWithoutLeakedTimeMarkers(text: string): Array<{start:number;end:number}> {
  const spans: Array<{start:number;end:number}> = [];
  const pattern = new RegExp(LEAKED_TIME_LINE.source, 'gm');
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > cursor) spans.push({start:cursor,end:start});
    cursor = start + match[0].length;
  }
  if (cursor < text.length) spans.push({start:cursor,end:text.length});
  return spans;
}

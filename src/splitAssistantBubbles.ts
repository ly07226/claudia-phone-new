/** Display-only, lossless slices. Never write these fragments to Message or context. */
export function splitAssistantBubbles(content: string): string[] {
  if (!content.trim()) return [];
  // Complex Markdown is intentionally left intact; this is not a Markdown/RP parser.
  if (/`|~~~|\*\*|__|^\s*(?:#{1,6}\s|[-+]\s|\d+\.\s|\|)/m.test(content))
    return [content];
  const actionWords =
    /抬|低头|点头|摇头|看向|望向|走|笑|伸手|握|转身|叹|轻声|停顿|坐|站|呼吸|眨眼|smil|nod|whisper|turn|sigh|look|reach|walk/i;
  const action = (text: string) =>
    /[（(*]/.test(text) && actionWords.test(text);
  const pairs: Record<string, string> = {
    "（": "）",
    "(": ")",
    "“": "”",
    "「": "」",
    "『": "』",
    "‘": "’",
    "\'": "\'",
    '"': '"',
    "*": "*",
  };
  const closing = new Set(Object.values(pairs));
  const stack: string[] = [];
  const ends: { end: number; paragraph: boolean }[] = [];
  // Only an unambiguous, long outer action wrapper permits sentence breaks inside it.
  const outer = content.trim();
  const longAction =
    outer.length > 180 &&
    action(outer.slice(0, 100)) &&
    ((outer.startsWith("（") && outer.endsWith("）")) ||
      (outer.startsWith("(") && outer.endsWith(")")) ||
      (outer.startsWith("*") && outer.endsWith("*")));
  let pending = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === "\\") {
      i++;
      pending = false;
      continue;
    }
    // Apostrophes inside words are not quote boundaries.
    const apostrophe =
      /['’]/.test(char) &&
      /[A-Za-z]/.test(content[i - 1] || "") &&
      /[A-Za-z]/.test(content[i + 1] || "");
    if (apostrophe) {
      pending = false;
      continue;
    }
    if (stack.at(-1) === char && closing.has(char)) stack.pop();
    else if (pairs[char]) stack.push(pairs[char]);
    else if (closing.has(char)) {
      if (stack.at(-1) !== char) return [content];
      stack.pop();
    }
    const period =
      char === "." &&
      /\s|$/.test(content[i + 1] || "") &&
      !/(?:\b[A-Za-z]{1,3}|\d|\.)$/.test(content.slice(Math.max(0, i - 8), i));
    const sentence = /[。！？!?]/.test(char) || period;
    if (sentence) pending = true;
    else if (!closing.has(char) && !/\s/.test(char)) pending = false;
    const internalAction =
      longAction && stack.length === 1 && ["）", ")", "*"].includes(stack[0]);
    const safe = stack.length === 0 || internalAction;
    const next = content[i + 1] || "";
    if (
      safe &&
      (char === "\n" ||
        (pending && !closing.has(next) && !/[。！？!?\.]/.test(next)))
    ) {
      let end = i + 1;
      while (end < content.length && /\s/.test(content[end])) end++;
      if (closing.has(content[end])) continue;
      ends.push({ end, paragraph: content.slice(i, end).includes("\n") });
      i = end - 1;
      pending = false;
    }
  }
  // Unbalanced quotes, brackets or stars: do not guess at their semantics.
  if (stack.length) return [content];
  if (ends.at(-1)?.end !== content.length)
    ends.push({ end: content.length, paragraph: true });
  const result: string[] = [];
  let start = 0,
    group = "";
  for (const { end, paragraph } of ends) {
    const part = content.slice(start, end);
    start = end;
    const limit = longAction || action(group + part) ? 160 : 80;
    if (group.trim() && (group + part).length > limit) {
      result.push(group);
      group = "";
    }
    group += part;
    if (paragraph && group.trim()) {
      result.push(group);
      group = "";
    }
  }
  if (group.trim()) result.push(group);
  else if (group && result.length) result[result.length - 1] += group;
  return result;
}

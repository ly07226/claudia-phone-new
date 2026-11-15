/** Display-only, lossless slices. Never write these fragments to Message or context. */
function legacyAssistantBubblesCore(content: string): string[] {
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
    // Ordinary sentences are bubbles in their own right, even below 80 chars.
    // Only action-related fragments retain the conservative packing budget.
    if ((paragraph || (!longAction && !action(group))) && group.trim()) {
      result.push(group);
      group = "";
    }
  }
  if (group.trim()) result.push(group);
  else if (group && result.length) result[result.length - 1] += group;
  // Stray punctuation/blank lines must not create their own display bubble.
  const bubbles: string[] = [];
  let prefix = "";
  for (const piece of result) {
    if (!/[\p{L}\p{N}\p{S}]/u.test(piece)) {
      if (bubbles.length) bubbles[bubbles.length - 1] += piece;
      else prefix += piece;
    } else {
      bubbles.push(prefix + piece);
      prefix = "";
    }
  }
  // An entirely punctuation-only reply has no visible bubble; Message stays intact.
  return bubbles;
}

/** Recognize complete roleplay wrappers only, never infer a fault from an open bracket.
 * Returned slices retain every character including inter-bubble whitespace. */
function splitAssistantBubblesCore(content: string): string[] {
  if (/`|~~~|\*\*|__|^\s*(?:#{1,6}\s|[-+]\s|\d+\.\s|\|)/m.test(content)) return legacyAssistantBubbles(content);
  const spans: {start:number;end:number}[] = [];
  const stack:string[]=[];
  let start=0;
  for(let i=0;i<content.length;i++) {
    const c=content[i];
    if(c==='\\'){i++;continue;}
    const quoteEnd:Record<string,string>={'“':'”','「':'」','『':'』','"':'"'};
    if(!stack.length&&quoteEnd[c]){
      let end=i+1;while(end<content.length&&(content[end]!==quoteEnd[c]||content[end-1]==='\\'))end++;
      if(end===content.length)return legacyAssistantBubbles(content);
      i=end;continue;
    }
    if(c==='（'||c==='('){if(!stack.length)start=i;stack.push(c==='（'?'）':')');}
    else if(c==='）'||c===')') {
      if(stack.pop()!==c)return legacyAssistantBubbles(content);
      if(!stack.length){
        const inner=content.slice(start+1,i).trim();
        // A subject + observable action/state is required. Explanations and
        // quoted conditions are deliberately left as speech, not classified.
        const roleplay=/^(?:我|他|她|你|我们|他们|她们|\*?I\b|he\b|she\b|you\b|看你|看着|低头|抬头|伸手|轻笑|微笑|转身|叹了|抓着|握住|心里|心想|窗外|屋里|房间里|四周|周围|空气中)/i.test(inner)
          && /抬|低头|点头|摇头|看|望|走|笑|伸手|握|转身|叹|轻声|坐|站|呼吸|眨眼|抓|凑|皱|靠|心想|心里|沉默|smil|nod|whisper|turn|sigh|look|reach|walk|think|wonder|传来|响起|弥漫|安静|心跳/i.test(inner)
          && !/^(?:比如|例如|也就是|即|注|备注|也许|如果|假如|要是)/.test(inner)
          && !/看过这|仅作说明|补充说明|不是动作/.test(inner);
        if(roleplay)spans.push({start,end:i+1});
      }
    }
  }
  if(!spans.length||(spans.length===1&&content.slice(0,spans[0].start).trim()===''&&content.slice(spans[0].end).trim()===''))return legacyAssistantBubbles(content);
  const cuts=new Set<number>([0,content.length]);
  for(const span of spans){cuts.add(span.start);cuts.add(span.end);}
  const points=[...cuts].sort((a,b)=>a-b),out:string[]=[];
  let pending='';
  for(let i=1;i<points.length;i++){
    const piece=content.slice(points[i-1],points[i]);
    if(!piece.trim()){if(out.length)out[out.length-1]+=piece;else pending+=piece;}
    else {
      const completeAction=spans.some(s=>s.start===points[i-1]&&s.end===points[i]);
      const fragments=completeAction?[pending+piece]:legacyAssistantBubbles(pending+piece);
      if(fragments.length){out.push(...fragments);pending='';}
      else if(out.length){out[out.length-1]+=pending+piece;pending='';}
      else pending+=piece;
    }
  }
  if(pending&&out.length)out[out.length-1]+=pending;
  return out.join('')===content?out:[content];
}

/** A punctuation-only line is an intentional separate chat bubble.
 * Keep newline characters attached to the punctuation bubble so slices remain
 * lossless and existing quote/deletion offsets are unchanged. */
function splitStandalonePunctuationLines(content:string,split:(value:string)=>string[]):string[]{
  const boundary=/^[ \t]*[?？.!！。]+[ \t]*(?:\r?\n|$)/gm;
  const parts:string[]=[];
  let cursor=0;
  for(const match of content.matchAll(boundary)){
    const index=match.index;
    if(index>cursor)parts.push(...split(content.slice(cursor,index)));
    parts.push(match[0]);
    cursor=index+match[0].length;
  }
  if(cursor<content.length)parts.push(...split(content.slice(cursor)));
  return parts.length?parts:split(content);
}
export function legacyAssistantBubbles(content:string):string[]{
  return splitStandalonePunctuationLines(content,legacyAssistantBubblesCore);
}
export function splitAssistantBubbles(content:string):string[]{
  return splitStandalonePunctuationLines(content,splitAssistantBubblesCore);
}

import type { Conversation } from "./chatTypes";
import type { LoreDiagnostic } from "./loreEngine";
export interface LoreTrace {
  conversationId: string;
  characterId: string;
  mode: Conversation["mode"];
  worldId?: string;
  createdAt: number;
  totalEntries: number;
  truncated: boolean;
  diagnostics: LoreDiagnostic[];
  skippedBooks: {lorebookId:string;reason:"book-disabled"|"out-of-scope"}[];
  totalSkippedBooks: number;
}
const traces = new Map<string,LoreTrace>();
function copyTrace(trace:LoreTrace):LoreTrace {
  return {...trace,diagnostics:trace.diagnostics.map(d=>({...d,matchedMessages:d.matchedMessages.map(m=>({...m}))})),skippedBooks:trace.skippedBooks.map(b=>({...b}))};
}
/** Volatile metadata only: no messages, keys, entry content, or persistent writes. */
export function recordLoreTrace(c:Conversation,diagnostics:LoreDiagnostic[],skippedBooks:LoreTrace["skippedBooks"]=[]) {
  const trace:LoreTrace={conversationId:c.id,characterId:c.characterId,mode:c.mode,...(c.mode==="world"?{worldId:c.worldId}:{}),createdAt:Date.now(),totalEntries:diagnostics.length,truncated:diagnostics.length>1000,diagnostics:diagnostics.slice(0,1000),skippedBooks:skippedBooks.slice(0,1000),totalSkippedBooks:skippedBooks.length};
  traces.delete(c.id);traces.set(c.id,copyTrace(trace));
  while(traces.size>10) traces.delete(traces.keys().next().value!);
}
export function lastLoreTrace(id:string):LoreTrace|null {
  const value=traces.get(id);return value?copyTrace(value):null;
}
export const loreReasonLabels:Record<LoreDiagnostic["reason"],string>={
  injected:"已注入", "book-disabled":"世界书已停用", "entry-disabled":"条目已停用", "compatibility-paused":"兼容性暂停",
  "no-user-message":"没有本轮用户消息", "regex-error":"正则错误或超时", "primary-miss":"主关键词未命中", "secondary-miss":"辅助条件未满足", probability:"概率未通过", "context-budget":"上下文预算不足", "book-budget":"本书预算不足",
};

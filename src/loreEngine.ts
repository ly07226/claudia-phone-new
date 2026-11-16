import { db } from "./store";
import { loreLimits, normalizeEntry, type Lorebook, type LoreEntry } from "./loreTypes";
import { evaluateRegex, type RegexHits } from "./loreRegex";
import type { Conversation, Message, ContextMessage } from "./chatTypes";
export interface LoreMessageRef { id: string; role: "user" | "assistant" }
export type LoreSkipReason = "injected" | "book-disabled" | "entry-disabled" | "compatibility-paused" | "no-user-message" | "regex-error" | "primary-miss" | "secondary-miss" | "probability" | "context-budget" | "book-budget";
export interface LoreDiagnostic {
  entryId: string;
  lorebookId: string;
  triggerMode: "constant" | "instant" | "history";
  scanAssistant: boolean | null;
  scannedMessageCount: number;
  matchedMessages: LoreMessageRef[];
  crossMessageMatch: boolean;
  attribution: "first-match-per-key" | "unavailable";
  outcome: "injected" | "skipped";
  reason: LoreSkipReason;
}
const ref = (m: Message): LoreMessageRef => ({id:m.id,role:m.role as LoreMessageRef["role"]});
export function loreScanMessages(raw: LoreEntry, book: Lorebook, history: Message[]) {
  const e = normalizeEntry(raw);
  if (e.constant) return [];
  if (e.triggerMode === "instant") {
    const latest = [...history].reverse().find(m=>m.role === "user");
    return latest ? [latest] : [];
  }
  // Window first, then role filtering: scanDepth remains a message count, not user-turn count.
  return history.slice(-(e.scanDepth ?? book.scanDepth)).filter(m=>m.role === "user" || (e.scanAssistant && m.role === "assistant"));
}
function scanBuffer(messages: Message[], foldCase = false) {
  let text = "";
  const spans = messages.map((m, index) => {
    if (index) text += "\n";
    const start = text.length;
    text += foldCase ? m.content.toLowerCase() : m.content;
    return {...ref(m),start,end:text.length};
  });
  return {text,spans};
}
function assess(raw: LoreEntry, b: Lorebook, h: Message[], random: () => number, regex?: RegexHits) {
  const e = normalizeEntry(raw);
  const d: LoreDiagnostic = {entryId:e.id,lorebookId:b.id,triggerMode:e.constant?"constant":e.triggerMode!,scanAssistant:e.constant || e.triggerMode === "instant" ? null : e.scanAssistant!,scannedMessageCount:0,matchedMessages:[],crossMessageMatch:false,attribution:"first-match-per-key",outcome:"skipped",reason:"primary-miss"};
  const fail = (reason:LoreSkipReason) => ({eligible:false,diagnostic:{...d,reason}});
  if (!b.enabled) return fail("book-disabled");
  if (!e.enabled) return fail("entry-disabled");
  if (e.compatibilityIssues.length) return fail("compatibility-paused");
  if (!e.constant) {
    const messages = loreScanMessages(e,b,h);
    d.scannedMessageCount = messages.length;
    if(e.triggerMode === "instant" && !messages.length) return fail("no-user-message");
    let primary:boolean[], secondary:boolean[];
    if(e.regex) {
      if(!regex || regex.error) return fail("regex-error");
      primary=regex.primary;secondary=regex.secondary;
      d.matchedMessages=(regex.matches || []).map(({id,role})=>({id,role}));
      d.crossMessageMatch=regex.crossMessageMatch || false;
      if(!regex.matches) d.attribution="unavailable";
    } else {
      const buffer=scanBuffer(messages,!e.caseSensitive);
      const matches=new Map<string,LoreMessageRef>();
      const hit=(key:string)=>{
        if(!key) return false;
        const needle=e.caseSensitive?key:key.toLowerCase();
        const start=buffer.text.indexOf(needle);
        if(start<0) return false;
        const end=start+needle.length;
        const origins=buffer.spans.filter(span=>span.start<end&&span.end>start);
        d.crossMessageMatch ||= origins.length>1;
        for(const origin of origins) matches.set(origin.id,{id:origin.id,role:origin.role});
        return true;
      };
      primary=e.primaryKeys.map(hit);secondary=e.secondaryKeys.map(hit);
      d.matchedMessages=[...matches.values()];
    }
    if(!primary.some(Boolean)) return fail("primary-miss");
    if(e.selective && e.secondaryKeys.length) {
      const passes = [()=>secondary.some(Boolean),()=>!secondary.every(Boolean),()=>!secondary.some(Boolean),()=>secondary.every(Boolean)][e.selectiveLogic]?.() || false;
      if(!passes) return fail("secondary-miss");
    }
  }
  if(!e.constant && e.useProbability && !(e.probability!>=100 || (e.probability!>0 && random()<e.probability!/100))) return fail("probability");
  return {eligible:true,diagnostic:d};
}
export function entryActive(raw:LoreEntry,b:Lorebook,h:Message[],random:()=>number=Math.random,regex?:RegexHits) {
  return assess(raw,b,h,random,regex).eligible;
}
/** Local, deterministic passage retrieval. No API calls or additional credentials. */
export function retrieveLorePassages(content:string,history:Message[],budget:number):string {
  if(content.length<=budget)return content;
  if(budget<=0)return "";
  const query=history.filter(m=>m.role==="user").slice(-3).map(m=>m.content).join(" ").toLowerCase();
  const terms=[...new Set((query.match(/[\p{Script=Han}]{2,4}|[a-z0-9]{3,}/gu)||[]))].slice(0,80);
  const chunks:string[]=[];
  for(const paragraph of content.split(/\n{2,}/)){
    for(let i=0;i<paragraph.length;i+=700)chunks.push(paragraph.slice(i,i+700));
  }
  const ranked=chunks.map((text,index)=>({text,index,score:terms.reduce((n,t)=>n+(text.toLowerCase().includes(t)?1:0),0)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen:{text:string;index:number}[]=[];let used=0;
  for(const item of ranked){
    const room=budget-used-(chosen.length?2:0);
    if(room<=0)break;
    if(item.text.length>room){if(!chosen.length)chosen.push({text:item.text.slice(0,room),index:item.index});break;}
    chosen.push(item);used+=item.text.length+2;
  }
  return chosen.sort((a,b)=>a.index-b.index).map(x=>x.text).join("\n\n");
}
export interface LoreCandidate {entry:LoreEntry;book:Lorebook}
/** Metadata only. Entry content, keys and chat text are never part of diagnostics. */
export function planLore(candidates:LoreCandidate[],history:Message[],remainingBudget=loreLimits.promptChars,random:()=>number=Math.random,regex:Record<string,RegexHits>={}) {
  // Always-on instructions must be considered before optional keyword lore.
  // They are not constrained by the ordinary 4k-per-book / 8k-total lore budgets.
  const sorted=candidates.map(c=>({...c,entry:normalizeEntry(c.entry)})).sort((a,b)=>Number(b.entry.constant)-Number(a.entry.constant) || b.entry.priority-a.entry.priority || a.entry.createdAt-b.entry.createdAt || (a.entry.id<b.entry.id?-1:a.entry.id>b.entry.id?1:0));
  const selected:LoreEntry[]=[],diagnostics:LoreDiagnostic[]=[];
  const used=new Map<string,number>();let total=0,optionalTotal=0;
  for(const {entry,book} of sorted) {
    const result=assess(entry,book,history,random,regex[entry.id]);
    const d=result.diagnostic;diagnostics.push(d);
    if(!result.eligible) continue;
    // Keep chat responsive: never fail a request solely because optional lore
    // exceeds its configured budget. Preserve whole entries when possible.
    const available=Math.min(remainingBudget-total,entry.constant?remainingBudget-total:Math.min(loreLimits.promptChars-optionalTotal,book.charBudget-(used.get(book.id)||0)));
    const effective=entry.constant?entry:{...entry,content:retrieveLorePassages(entry.content,history,Math.max(0,available-2))};
    const cost=effective.content.length+2,bookUsed=used.get(book.id)||0;
    if(!effective.content.trim()){d.reason="context-budget";continue;}
    if(entry.constant && total+cost>remainingBudget) {
      d.reason="context-budget";
      throw Error("当前聊天设定过长，暂时无法生成回复。请在设置中调整后重试。");
    }
    if(!entry.constant && (total+cost>remainingBudget || optionalTotal+cost>loreLimits.promptChars)){d.reason="context-budget";continue;}
    if(!entry.constant && bookUsed+cost>book.charBudget){d.reason="book-budget";continue;}
    if(!entry.constant){used.set(book.id,bookUsed+cost);optionalTotal+=cost;}
    total+=cost;selected.push(effective);
    d.outcome="injected";d.reason="injected";
  }
  return {entries:selected,activated:selected.map(e=>e.id),diagnostics,regexErrors:Object.fromEntries(Object.entries(regex).filter(([,r])=>r.error).map(([id,r])=>[id,r.error]))};
}
export function injectLore(
  system: string,
  history: ContextMessage[],
  entries: LoreEntry[],
): ContextMessage[] {
  const sorted = entries.map(normalizeEntry);
  const own = (e: LoreEntry): ContextMessage => ({
    role: e.role!,
    content: e.content,
  });
  // Preserve legacy default System profile placement inside the first system message.
  const profileEntries = sorted.filter(
    (e) =>
      e.insertionPosition === "before-profile" ||
      e.insertionPosition === "after-profile",
  );
  const splitProfile = profileEntries.some((e) => e.role !== "system");
  const before = profileEntries.filter(
    (e) => e.insertionPosition === "before-profile",
  );
  const after = profileEntries.filter(
    (e) => e.insertionPosition === "after-profile",
  );
  const prefix: ContextMessage[] = splitProfile
    ? [
        { role: "system", content: "以下是当前会话的角色与设定资料。" },
        ...before.map(own),
        { role: "system", content: system },
        ...after.map(own),
      ]
    : [
        {
          role: "system",
          content: [
            ...before.map((e) => e.content),
            system,
            ...after.map((e) => e.content),
          ].join("\n\n"),
        },
      ];
  const slots: Array<ContextMessage[]> = Array.from(
    { length: history.length + 1 },
    () => [],
  );
  for (const e of sorted) {
    if (
      e.insertionPosition === "before-profile" ||
      e.insertionPosition === "after-profile"
    ) {
      continue;
    }
    const index =
      e.insertionPosition === "after-conversation"
        ? history.length
        : e.insertionPosition === "at-depth"
          ? Math.max(0, history.length - e.insertionDepth!)
          : 0;
    slots[index].push(own(e));
  }
  return [
    ...prefix,
    ...slots.flatMap((slot, i) =>
      i < history.length ? [...slot, history[i]] : slot,
    ),
  ];
}
export async function loreForConversation(
  c: Conversation,
  history: Message[],
  remainingBudget = loreLimits.promptChars,
  random: () => number = Math.random,
) {
  const skippedBooks: {lorebookId:string;reason:"book-disabled"|"out-of-scope"}[] = [];
  const books = await db.lorebooks.filter(b => {
    const inScope = b.global || (c.mode === "world" && !!c.worldId && b.worldIds.includes(c.worldId));
    if(!inScope || !b.enabled) {skippedBooks.push({lorebookId:b.id,reason:!inScope?"out-of-scope":"book-disabled"});return false;}
    return true;
  }).toArray();
  const candidates: LoreCandidate[] = [];
  for (const book of books) {
    const entries = await db.loreEntries
      .where("lorebookId")
      .equals(book.id)
      .toArray();
    for (const raw of entries)
      candidates.push({ entry: normalizeEntry(raw), book });
  }
  const jobs = candidates
    .filter(
      ({ entry: e, book: b }) =>
        b.enabled &&
        e.enabled &&
        !e.compatibilityIssues.length &&
        e.regex &&
        !e.constant,
    )
    .map(({ entry: e, book: b }) => ({
      id: e.id,
      ...scanBuffer(loreScanMessages(e, b, history)),
      primary: e.primaryKeys,
      secondary: e.secondaryKeys,
      caseSensitive: e.caseSensitive,
    }));
  return {...planLore(
    candidates,
    history,
    remainingBudget,
    random,
    await evaluateRegex(jobs),
  ), skippedBooks, entryScopes:Object.fromEntries(candidates.map(({entry,book})=>[entry.id,book.global?'global' as const:'world' as const]))};
}

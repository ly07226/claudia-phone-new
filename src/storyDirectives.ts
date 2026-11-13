import type {StoryGuidance,StorySegment} from './storyTypes';
import {storyLimits} from './storyTypes';
export type NarrativePerspective='first'|'second'|'third';
export interface StoryDirectives {
 perspective:NarrativePerspective;perspectiveSource:'setting'|'guidance';
 length?:{min:number;max:number;unit:'nonWhitespaceCharacters'};
 dialogueMaxRatio?:number;conflict:boolean;
}
/** Closed, balanced quotation spans only; an unmatched quote cannot hide the rest
 * of a reply. Apostrophes inside words are not opening dialogue quotes. */
export function quotationSpans(text:string){
 const pairs:Record<string,string>={'“':'”','「':'」','『':'』','‘':'’','"':'"',"'":"'"};
 const spans:{start:number;end:number}[]=[],stack:{open:string;close:string;start:number}[]=[];
 for(let i=0;i<text.length;i++){
  const ch=text[i];if(ch==='"'||ch==="'"){let escapes=0;for(let j=i-1;j>=0&&text[j]==='\\';j--)escapes++;if(escapes%2===1)continue;}
  if(stack.at(-1)?.close===ch){const q=stack.pop()!;if(!stack.length)spans.push({start:q.start,end:i+1});continue;}
  if(pairs[ch]&&!(ch==="'"&&/[\p{L}\p{N}]/u.test(text[i-1]??'')))stack.push({open:ch,close:pairs[ch],start:i});
 }
 return spans;
}
const mask=(text:string,spans:readonly {start:number;end:number}[])=>{const chars=text.split('');for(const {start,end} of spans)for(let i=start;i<end;i++)if(chars[i]!=='\n')chars[i]=' ';return chars.join('');};
/** Deliberately limited grammar. Original guidance always remains in the request;
 * unsupported prose is not silently converted into a guessed hard constraint. */
export function resolveStoryDirectives(perspective:NarrativePerspective='second',guidance?:StoryGuidance):StoryDirectives{
 const result:StoryDirectives={perspective,perspectiveSource:'setting',conflict:false};
 if(!guidance?.enabled)return result;
 const text=mask(guidance.text.normalize('NFKC'),quotationSpans(guidance.text.normalize('NFKC'))).split(/[。；;\n]/u).filter(c=>!/^\s*(?:例如|比如|示例|假设)/u.test(c)).join('；');
 for(const clause of text.split(/[。；;\n，,]/u)){
  if(/NPC|角色|对白|对话/iu.test(clause)&&!/旁白|叙述|叙事/iu.test(clause))continue;
  const re=/(?:保持|坚持|改用|改为|切换为|使用|采用|以|用)?\s*(第[一二三]|[123])人称(?:叙述|叙事|视角)?/gu;
  for(const m of clause.matchAll(re)){
   const prefix=clause.slice(0,m.index);if(/(?:不|不要|不用|禁止|避免|并非|不是|不得|不再|不使用)\s*$/u.test(prefix))continue;
   result.perspective=({'第一':'first','第二':'second','第三':'third','1':'first','2':'second','3':'third'} as const)[m[1] as '第一'];result.perspectiveSource='guidance';
  }
 }
 const number='([0-9]{1,6})',limits:{min:number;max:number}[]=[];
 const positive=(index:number)=>!/(?:不要|不必|不需要|取消|忽略|并非|不是)[^。；;\n，,]{0,8}$/u.test(text.slice(0,index));
 for(const m of text.matchAll(new RegExp(number+'\\s*(?:～|~|-|至|到)\\s*'+number+'\\s*(?:个)?字','gu')))if(positive(m.index!))limits.push({min:Number(m[1]),max:Number(m[2])});
 for(const m of text.matchAll(new RegExp('(?:至少|不少于|不低于)\\s*'+number+'\\s*(?:个)?字','gu')))if(positive(m.index!))limits.push({min:Number(m[1]),max:storyLimits.body});
 for(const m of text.matchAll(new RegExp('(?:不超过|至多|最多|不多于)\\s*'+number+'\\s*(?:个)?字','gu')))if(positive(m.index!))limits.push({min:1,max:Number(m[1])});
 for(const m of text.matchAll(/(?:正文(?:目标|字数)?\s*(?:为|写|约|大约|目标约)?|(?:目标|大约|约)|^\s*)([0-9]{1,6})\s*(?:个)?字/gu))if(positive(m.index!)){const n=Number(m[1]);limits.push({min:Math.floor(n*.8),max:Math.ceil(n*1.2)});}
 if(limits.length)result.length={min:Math.max(...limits.map(x=>x.min)),max:Math.min(storyLimits.body,...limits.map(x=>x.max)),unit:'nonWhitespaceCharacters'};
 for(const m of text.matchAll(/(?:对白|对话)(?:比例|占比|比重)?\s*(?:不超过|最多|至多|<=|≤)\s*([0-9]{1,3})\s*%/gu))if(positive(m.index!)){const value=Number(m[1])/100;if(value>1)result.conflict=true;result.dialogueMaxRatio=Math.min(result.dialogueMaxRatio??1,value);}
 if(result.length){const {min,max}=result.length;result.conflict ||= min<1||max<min||min>storyLimits.body;}
 return result;
}
export type DirectiveViolation={code:'directive-perspective'|'directive-length'|'directive-dialogue';observed:number;min?:number;max?:number};
/** Only evidence-backed surface violations. No claim of a semantic agency judge.
 * Valid NPC dialogue segments and balanced quotes are excluded from narrative POV. */
export function checkStoryDirectives(body:string,segments:readonly StorySegment[]|undefined,d:StoryDirectives,npcNames:readonly string[]=[]){
 const quotes=quotationSpans(body),npc: {start:number;end:number}[]=[];let cursor=0,dialogueChars=0;
 if(segments)for(const segment of segments){if(segment.type==='dialogue'){dialogueChars+=Array.from(segment.text.replace(/\s/gu,'')).length;if(npcNames.includes(segment.speaker))npc.push({start:cursor,end:cursor+segment.text.length});}cursor+=segment.text.length;}
 // Without structured dialogue, count clearly attributed speech, not short titles
 // or words merely placed in quotes. Ambiguous dialogue ratios stay unverified.
 if(!segments)for(const q of quotes)if(/(?:说|问|答|喊|道|低语|开口)[^。！？!?\n]{0,8}[:：]?\s*$/u.test(body.slice(Math.max(0,q.start-30),q.start)))dialogueChars+=Array.from(body.slice(q.start,q.end).replace(/\s/gu,'')).length;
 const narration=mask(body,[...quotes,...npc]).replace(/[“”「」『』‘’"']/gu,' '),problems:DirectiveViolation[]=[];
 const lead='(?:^|[。！？!?；;\\n，,：:])\\s*(?:(?:于是|随后|此时|然而|但是|这时|接着)[，,]?\\s*)?';
 const first=new RegExp(lead+'我(?!们|方|国|军|等|辈|党|校)(?:的|(?=看|听|推|走|停|抬|低|伸|转|回|拿|握|说|问|想|感|觉|决|同意|答应|站|坐|跑|来|要|会|是|没有|不|把|将|正|已))','gu');
 const second=new RegExp(lead+'你(?!们|方)(?:的|(?=看|听|推|走|停|抬|低|伸|转|回|拿|握|说|问|想|感|觉|决|同意|答应|站|坐|跑|来|要|会|是|没有|不|把|将|正|已))','gu');
 const narrativeMatches=(re:RegExp)=>Array.from(narration.matchAll(re)).filter(m=>!/(?:说|问|答|喊|道|低语|开口)\s*$/u.test(narration.slice(Math.max(0,m.index!-30),m.index))).length;
 const wrongFirst=d.perspective!=='first'?narrativeMatches(first):0;
 const wrongSecond=d.perspective!=='second'?narrativeMatches(second):0;
 if(wrongFirst+wrongSecond)problems.push({code:'directive-perspective',observed:wrongFirst+wrongSecond});
 const count=Array.from(body.replace(/\s/gu,'')).length;
 if(d.length&&(count<d.length.min||count>d.length.max))problems.push({code:'directive-length',observed:count,...d.length});
 if(d.dialogueMaxRatio!==undefined&&count&&dialogueChars/count>d.dialogueMaxRatio)problems.push({code:'directive-dialogue',observed:Math.round(dialogueChars/count*100),max:d.dialogueMaxRatio*100});
 return problems;
}
export const directiveCorrectionNotice='明确人称或量化指导不符时，最多额外调用1次纠正并计费；仍不合格不保存。';

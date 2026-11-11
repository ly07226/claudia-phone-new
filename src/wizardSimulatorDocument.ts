/** Source-faithful simulator document index. This does not summarize or rewrite rules. */
export type SimulatorSectionKind='core_rules'|'world'|'mechanics'|'characters'|'opening_gate'|'output_protocol'|'events'|'other';
export interface SimulatorSection {id:string;heading:string;kind:SimulatorSectionKind;start:number;end:number;body:string}
const headings=[{kind:'opening_gate',re:/开局规则|开场角色卡|玩家角色卡/},{kind:'output_protocol',re:/输出格式|叙事规则|叙事要求|剧情推进|节奏规则/},{kind:'mechanics',re:/感染|ABO|物资|基地|名声|信任|世界运作|安全规则/},{kind:'events',re:/随机事件|主要冲突|核心方向/},{kind:'characters',re:/重要角色|角色卡|角色定位|人物|夏以昼|关系线/},{kind:'core_rules',re:/AI.?运作核心规则|AI.?角色规则/},{kind:'world',re:/世界观|世界现况|游戏核心氛围/}] as const;
function classify(heading:string):SimulatorSectionKind {return headings.find(h=>h.re.test(heading))?.kind??'other';}
const markdownHeading=/^\s{0,3}#{1,6}\s+(.+?)\s*$/;
const plainHeading=/^(?:AI\s*运作核心规则|世界观核心|世界现况|感染者设定|感染方式|感染者特征|感染阶段|ABO\s*末世规则|重要物资|幸存者基地|常见基地类型|世界主要冲突|游戏核心氛围|叙事规则|剧情描写规定|节奏规则|关系规则|ABO\s*安全规则|世界运作规则|随机事件规则|名声与信任系统|AI\s*叙事要求|开局规则|开场角色卡|玩家角色卡|剧情推进与输出格式[^\n]*|AI\s*角色规则|重要角色[^\n]*|角色卡|夏以昼|基本资料|末世前背景|目前状态|ABO\s*相关设定|所属位置或势力|表面身份|真实需求|可提供的资源|可能隐瞒的秘密|生存压力与选择理由|与.{0,12}的关系线[^\n]*|角色定位总结|常见角色类型|游戏核心方向)$/;
function detectedHeading(line:string):string|undefined {
 const trimmed=line.trim().replace(/^【(.+)】$/,'$1');
 const markdown=trimmed.match(markdownHeading);if(markdown)return markdown[1].trim();
 return trimmed.length<=70&&plainHeading.test(trimmed)?trimmed:undefined;
}
/** Works for Markdown and DOCX plain-text extraction; offsets point into the exact original body. */
export function indexSimulatorDocument(body:string):SimulatorSection[]{
 const out:SimulatorSection[]=[];let start=0,heading='文档开头',number=0;
 const push=(end:number)=>{if(end>start){const sectionBody=body.slice(start,end);if(sectionBody.trim())out.push({id:'section-'+number++,heading,kind:classify(heading),start,end,body:sectionBody});}};
 const lineRe=/[^\r\n]*(?:\r\n|\r|\n|$)/g;let match:RegExpExecArray|null;
 while((match=lineRe.exec(body))){if(!match[0])break;const found=detectedHeading(match[0]);if(found){push(match.index);heading=found;start=match.index;}}
 push(body.length);return out.length?out:[{id:'section-0',heading:'全文',kind:'other',start:0,end:body.length,body}];
}
export interface SimulatorRuleEvidence {sectionId:string;heading:string;kind:SimulatorSectionKind;excerpt:string;start:number;end:number}
/** Exact quotations with offsets: not inferred facts. */
export function simulatorEvidence(sections:SimulatorSection[],terms:string[],limit=12):SimulatorRuleEvidence[]{
 const query=terms.map(s=>s.trim()).filter(Boolean);const hits:SimulatorRuleEvidence[]=[];
 for(const s of sections){if(!query.some(t=>s.heading.includes(t)||s.body.includes(t)))continue;const term=query.find(t=>s.body.includes(t));const at=term?s.body.indexOf(term):0;const a=Math.max(0,at-120),b=Math.min(s.body.length,at+260);hits.push({sectionId:s.id,heading:s.heading,kind:s.kind,excerpt:s.body.slice(a,b),start:s.start+a,end:s.start+b});if(hits.length>=limit)break;}
 return hits;
}

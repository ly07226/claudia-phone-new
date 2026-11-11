/** Source-faithful simulator document index. This does not summarize or rewrite rules. */
export type SimulatorSectionKind='core_rules'|'world'|'mechanics'|'characters'|'opening_gate'|'output_protocol'|'events'|'other';
export interface SimulatorSection {id:string;heading:string;kind:SimulatorSectionKind;start:number;end:number;body:string}
const headings=[{kind:'opening_gate',re:/开局|开场|玩家资料/},{kind:'output_protocol',re:/输出|叙事|剧情推进|节奏/},{kind:'mechanics',re:/资源|物资|时间|状态|机制|运作|数值|条件/},{kind:'events',re:/事件|冲突|方向|伏笔/},{kind:'characters',re:/角色|人物|身份|性格|关系/},{kind:'core_rules',re:/核心规则|禁止|约束/},{kind:'world',re:/世界|背景|地理|历史/}] as const;
function classify(heading:string):SimulatorSectionKind{return headings.find(h=>h.re.test(heading))?.kind??'other';}
function detectedHeading(line:string):string|undefined{
 const text=line.trim();const markdown=text.match(/^#{1,6}\s+(.+?)\s*$/);if(markdown)return markdown[1];
 const bracket=text.match(/^【([^】]{1,70})】$/);if(bracket)return bracket[1];
 return text.length<=70&&/^(?:[一二三四五六七八九十0-9]+[、.．]\s*)?[^。！？!?：:]{1,60}(?:设定|背景|规则|机制|人物|角色|事件|秘密|方向|状态|资料|条件|世界观)[：:]?$/.test(text)?text:undefined;
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

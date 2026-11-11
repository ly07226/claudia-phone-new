/** Keep the source archive intact; select only the references needed for this turn. */
export function fitDocumentInput(input:Record<string,any>,prompt:string,limit:number){
 const size=(x:unknown)=>new TextEncoder().encode(prompt+JSON.stringify(x)).length;
 if(size(input)<=limit)return JSON.stringify(input);
 const rules=input.simulatorRules?.rules;if(!Array.isArray(rules))throw Error('budget');
 const referenceOnly=typeof input.simulatorRules?.instruction==='string'&&input.simulatorRules.instruction.includes('原文叙事');
 const optional=new Set(['background','event','direction','uninterpreted']);
 const required=referenceOnly?[]:rules.filter((r:any)=>!optional.has(r.kind));
 const selected=new Set<any>(required),original=rules.length,knowledge=input.documentKnowledge;
 const originalKnowledge=knowledge?structuredClone(knowledge):undefined;
 const rebuild=()=>{
  input.simulatorRules.rules=rules.filter((r:any)=>selected.has(r));
  if(originalKnowledge){
   const ids=new Set(input.simulatorRules.rules.map((r:any)=>r.id));
   input.documentKnowledge={...originalKnowledge,player:originalKnowledge.player.filter((id:string)=>ids.has(id)),characters:originalKnowledge.characters.map((c:any)=>({...c,known:c.known.filter((id:string)=>ids.has(id))}))};
  }
  input.documentSelection={originalPublicFindings:original,includedPublicFindings:selected.size,notice:referenceOnly?'本次按需选取原文前置信息与相关段落；完整原文仍在本地归档。请先理解世界观和角色关系，再根据当前情节创作，不得把未提供的段落编造为已发生事实。':'背景、事件和方向按预算选择完整引用；其余仍在原文归档，不得编造未提供内容。规则和人物必要资料未截断。'};
  return size(input);
 };
 // A long imported document may also be copied into the world's description
 // or background. Selecting rule excerpts alone cannot fix that duplication.
 // Keep the saved world untouched: this input is a per-request JSON snapshot.
 if(rebuild()>limit&&referenceOnly){
  const def=input.definition;
  if(def){
   for(const field of ['description','background'] as const){
    if(typeof def[field]!=='string')continue;
    const original=def[field] as string;
    if(!original)continue;
    // Prefer the beginning (premise, cast, world), retaining a small ending anchor.
    const maxChars=2400;
    if(original.length>maxChars)def[field]=original.slice(0,2000)+'\\n[其余原文已保存在剧本归档，按后续剧情检索]\\n'+original.slice(-350);
   }
  }
 }
 if(rebuild()>limit)throw Error('budget');
 const query=JSON.stringify([input.selectedAction,input.confirmedHistory?.at(-1),input.definition?.script?.opening]);
 const score=(text:string)=>{let hits=0;for(let i=0;i<Math.min(text.length-1,400);i+=2)if(query.includes(text.slice(i,i+2)))hits++;return hits;};
 const optionalRules=rules.filter((r:any)=>!selected.has(r));
 // On the opening turn, prioritize early world-building and character information.
 // Later turns prioritize relevant references, but still include a small opening anchor.
 const opening=!Array.isArray(input.confirmedHistory)||input.confirmedHistory.length===0;
 const ranked=optionalRules.map((r:any,i:number)=>({r,i,relevance:score(r.text??'')})).sort((a,b)=>opening?a.i-b.i:b.relevance-a.relevance||a.i-b.i);
 const ordered=opening?ranked:[...ranked.filter(x=>x.i<3),...ranked.filter(x=>x.i>=3)];
 for(const {r} of ordered){selected.add(r);if(rebuild()>limit)selected.delete(r);}
 rebuild();return JSON.stringify(input);
}

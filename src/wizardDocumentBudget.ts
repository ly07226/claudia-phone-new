import {scoreStoryTexts} from './storyHistory';
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
 // Never slice independently entered world metadata to make references fit.
 if(rebuild()>limit)throw Error('budget');
 const opening=!Array.isArray(input.confirmedHistory)||input.confirmedHistory.length===0;
 const optionalRules=rules.filter((r:any)=>!selected.has(r));
 // On the opening turn, prioritize early world-building and character information.
 // Later turns prioritize relevant references, but still include a small opening anchor.
 const relevance=scoreStoryTexts(optionalRules.map((r:any)=>r.text??''),input.selectedAction?.text??'',opening?input.definition?.script?.opening??'':input.confirmedHistory.at(-1)?.body??'');
 const ranked=optionalRules.map((r:any,i:number)=>({r,i,relevance:relevance[i].action*4+relevance[i].recent})).sort((a,b)=>opening?a.i-b.i:b.relevance-a.relevance||a.i-b.i);
 const anchors=opening?['world-reference','character-reference','opening-reference'].flatMap(kind=>ranked.filter(x=>x.r.kind===kind).slice(0,3)):ranked.filter(x=>x.i<3);
 const ordered=opening?[...anchors,...ranked.filter(x=>!anchors.includes(x))]:[...ranked.slice(0,1),...anchors.slice(0,1),...ranked.slice(1)];
 for(const {r} of ordered){selected.add(r);if(rebuild()>limit)selected.delete(r);}
 rebuild();return JSON.stringify(input);
}

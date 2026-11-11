/** Whole, reviewed citations only. Mandatory rules are never prefix-truncated. */
export function fitDocumentInput(input:Record<string,any>,prompt:string,limit:number){
 const size=(x:unknown)=>new TextEncoder().encode(prompt+JSON.stringify(x)).length;
 if(size(input)<=limit)return JSON.stringify(input);
 const rules=input.simulatorRules?.rules;if(!Array.isArray(rules))throw Error('budget');
 const optional=new Set(['background','event','direction']),required=rules.filter((r:any)=>!optional.has(r.kind));
 const selected=new Set(required),original=rules.length,knowledge=input.documentKnowledge;
 const rebuild=()=>{
  input.simulatorRules.rules=rules.filter((r:any)=>selected.has(r));
  if(knowledge){const ids=new Set(input.simulatorRules.rules.map((r:any)=>r.id));input.documentKnowledge={...knowledge,player:knowledge.player.filter((id:string)=>ids.has(id)),characters:knowledge.characters.map((c:any)=>({...c,known:c.known.filter((id:string)=>ids.has(id))}))};}
  input.documentSelection={originalPublicFindings:original,includedPublicFindings:selected.size,notice:'背景、事件和方向按预算选择完整引用；其余仍在原文归档，不得编造未提供内容。规则和人物必要资料未截断。'};
  return size(input);
 };
 if(rebuild()>limit)throw Error('budget');
 const query=JSON.stringify([input.selectedAction,input.confirmedHistory?.at(-1),input.definition?.script?.opening]);
 const score=(text:string)=>{let hits=0;for(let i=0;i<Math.min(text.length-1,400);i+=2)if(query.includes(text.slice(i,i+2)))hits++;return hits;};
 for(const r of rules.filter((r:any)=>optional.has(r.kind)).sort((a:any,b:any)=>score(b.text)-score(a.text))){selected.add(r);if(rebuild()>limit)selected.delete(r);}
 rebuild();return JSON.stringify(input);
}

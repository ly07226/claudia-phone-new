import {referenceDocumentPolicy} from './wizardReferenceDocument';
import type {StoryDocumentSnapshot} from './wizardDocumentSnapshot';
import type {SimulatorState} from './wizardSimulatorState';
import {readLongNarrative} from './wizardLongNarrative';
import {indexSimulatorDocument} from './wizardSimulatorDocument';
import {planSimulatorAnalysis,checkSimulatorCoverage} from './wizardSimulatorCoverage';
import {listSimulatorReviews,listSimulatorDecisions} from './wizardSimulatorReviewStore';
import {simulatorAuditStatus} from './wizardSimulatorAudit';

export interface SimulatorRuntimePolicy {
 referenceOnly?:true;
 sourceId:string;
 simulation:boolean;
 sourceName:string;
 publicRules:{kind:string;text:string;sourceStart:number;sourceEnd:number;certainty:string}[];
 restrictedFacts:{terms:string[];knownBy:string[];revealed:boolean;start:number;end:number}[];
 secretCount:number;
 /** Internal-only evidence for checking existing story context; never send to the model. */
 secretEvidence:string[];
 reviewedChunks:number;
}
/** Build source-backed rules; knowledge metadata is not a turn-generation gate. */
export async function compileSimulatorRuntime(sourceId:string,snapshot?:StoryDocumentSnapshot,state:SimulatorState={},history:readonly SimulatorState[]=[]):Promise<SimulatorRuntimePolicy>{
 const source=snapshot?.source??await readLongNarrative(sourceId);
 if(!source)throw Error('模拟器原文已丢失，不能启用规则。');
 if(snapshot?.referenceOnly)return referenceDocumentPolicy(source);
 const chunks=planSimulatorAnalysis(source.body,indexSimulatorDocument(source.body),snapshot?.automation?.chunkChars);
 if(!checkSimulatorCoverage(source.body,chunks).complete)throw Error('模拟器原文覆盖校验失败。');
 const reviews=snapshot?.reviews??await listSimulatorReviews(source.id,source.body.length);
 const decisions=snapshot?.decisions??await listSimulatorDecisions(source.id,source.body.length);
 const audit=simulatorAuditStatus(chunks,reviews,decisions);
 if(!audit.ready)return referenceDocumentPolicy(source);
 const byChunk=new Map(reviews.map(r=>[r.review.chunkIndex,r]));
 const publicRules:SimulatorRuntimePolicy['publicRules']=[];
 const secretEvidence:string[]=[];
 const acceptedPublic:{kind:string;text:string;sourceStart:number;sourceEnd:number;certainty:string}[]=[];
 const restrictedFacts:SimulatorRuntimePolicy['restrictedFacts']=[];
 let secretCount=0;
 for(let i=0;i<chunks.length;i++){
  const saved=byChunk.get(i);
  if(!saved)throw Error('模拟器审核记录缺失。');
  for(const finding of saved.review.findings){
   const decision=decisions.find(d=>d.sourceId===source.id&&d.sourceLength===source.body.length&&d.chunkIndex===i&&d.findingStart===finding.start&&d.findingEnd===finding.end&&d.quote===finding.quote);
   if(decision?.decision!=='accepted')continue;
   if(source.body.slice(finding.start,finding.end)!==finding.quote)throw Error('规则引用已失效。');
   if(finding.kind==='secret'){
    const terms=[finding.quote,...decision.protectedTerms??finding.protectedTerms??[]];
    const revealed=!!decision.playerKnown||!!(decision.revealWhen&&[state,...history].some(s=>Object.hasOwn(s,decision.revealWhen!.key)&&s[decision.revealWhen!.key]===decision.revealWhen!.equals));
    restrictedFacts.push({terms,knownBy:decision.knownBy??[],revealed,start:finding.start,end:finding.end});
    if(!revealed){secretCount++;secretEvidence.push(...terms);continue;}
   }
   acceptedPublic.push({kind:finding.kind,text:finding.quote,sourceStart:finding.start,sourceEnd:finding.end,certainty:finding.certainty??'uncertain'});
  }
 }
 // Author-accepted references may overlap. Knowledge metadata is advisory, not a turn-generation gate.
 publicRules.push(...acceptedPublic);
 return {restrictedFacts,simulation:snapshot?snapshot.mode==='simulation':true,sourceId:source.id,sourceName:source.name,publicRules,secretCount,secretEvidence,reviewedChunks:chunks.length};
}

/** Exact/normalized evidence guard, not a semantic paraphrase detector. */
export function containsHiddenEvidence(value:unknown,policy:SimulatorRuntimePolicy|undefined):boolean {
 if(!policy)return false;const normalize=(s:string)=>s.normalize('NFKC').replace(/\s/gu,'');
 if(typeof value==='string')return policy.secretEvidence.some(s=>normalize(s).length>0&&normalize(value).includes(normalize(s)));
 if(Array.isArray(value))return value.some(v=>containsHiddenEvidence(v,policy));
 return !!value&&typeof value==='object'&&Object.entries(value).some(([k,v])=>containsHiddenEvidence(k,policy)||containsHiddenEvidence(v,policy));
}

export function documentKnowledge(policy:SimulatorRuntimePolicy,names:string[],playerName?:string){
 if(policy.referenceOnly)return {player:[],characters:names.map(name=>({name,known:[]})),instruction:'这些原文仅供叙述者参考，尚未结构化确认玩家或角色的知情范围。后台保存原文不等于任何人物已知；按原文关系和已确认剧情判断，不擅自提前揭示秘密。'};
 const ids=policy.publicRules.map(r=>`${r.sourceStart}:${r.sourceEnd}`);
 return {player:ids,characters:names.map(name=>({name,known:policy.publicRules.flatMap((r,i)=>policy.restrictedFacts.some(f=>f.revealed&&f.start===r.sourceStart&&f.end===r.sourceEnd&&!f.knownBy.includes(name)&&name!==playerName)?[]:[ids[i]])})),instruction:'编号对应已审核资料的原文范围；玩家知道不等于所有角色知道。系统持有但未公开的秘密内容未发送。'};
}

import type {SavedSimulatorReview} from './wizardSimulatorReviewStore';
import type {VerifiedSimulatorFinding} from './wizardSimulatorReview';
export interface SimulatorReviewPair {id:string;left:VerifiedSimulatorFinding;right:VerifiedSimulatorFinding;reason:string}
/** Potential disagreements only; NEVER declare a contradiction from keyword overlap alone. */
export function findSimulatorReviewPairs(saved:SavedSimulatorReview[],limit=80):SimulatorReviewPair[]{
 const findings=saved.flatMap(x=>x.review.findings).filter(f=>f.kind==='requirement'||f.kind==='prohibition'||f.kind==='permission'||f.kind==='world_fact');
 const pairs:SimulatorReviewPair[]=[];
 for(let i=0;i<findings.length;i++)for(let j=i+1;j<findings.length;j++){
  const a=findings[i],b=findings[j];
  if(a.start===b.start&&a.end===b.end)continue;
  const aNegative=/禁止|不得|不允许|不可|不能|不再|没有|并非|不是/.test(a.quote);
  const bNegative=/禁止|不得|不允许|不可|不能|不再|没有|并非|不是/.test(b.quote);
  if(aNegative===bNegative)continue;
  const terms=(a.quote.match(/[\u4e00-\u9fff]{2,5}/g)??[]).filter(x=>!['不得','不能','不允许','必须','可以','角色','世界','玩家'].includes(x));
  if(!terms.some(t=>b.quote.includes(t)))continue;
  pairs.push({id:[a.start,a.end,b.start,b.end].join(':'),left:a,right:b,reason:'原文包含相近用词，但否定方向不同；可能是例外、时间变化或不同主体，需人工判断。'});
  if(pairs.length>=limit)return pairs;
 }
 return pairs;
}

import type {SimulatorSection,SimulatorSectionKind} from './wizardSimulatorDocument';
export type RuleMode='prohibition'|'requirement'|'conditional'|'permission'|'world_fact'|'unclassified';
export interface SimulatorRule {id:string;mode:RuleMode;sectionId:string;sectionKind:SimulatorSectionKind;heading:string;source:string;start:number;end:number;condition?:string;effect?:string}
/** A conservative, deterministic candidate extractor. Does NOT claim semantic understanding. */
export function extractSimulatorRuleCandidates(sections:SimulatorSection[]):SimulatorRule[]{
 const rules:SimulatorRule[]=[];
 for(const section of sections){
  const linePattern=/[^\r\n]*(?:\r\n|\r|\n|$)/g;let lineMatch:RegExpExecArray|null;
  while((lineMatch=linePattern.exec(section.body))){
   const raw=lineMatch[0];if(!raw)break;
   const line=raw.replace(/[\r\n]+$/,'');
   const trimmed=line.trim().replace(/^[-*•]\s*/,'');
   const start=section.start+lineMatch.index+Math.max(0,line.search(/\S/));
   if(trimmed.length<5||trimmed.length>600||/^#{1,6}\s/.test(trimmed))continue;
   const mode:RuleMode=/禁止|不得|不可|不允许|不能擅自/.test(trimmed)?'prohibition':/必须|务必|应当|需要|严格遵守/.test(trimmed)?'requirement':/如果|当.{1,40}时|一旦|除非|若|在.{1,40}情况下/.test(trimmed)?'conditional':/可以|允许|可根据|可自由/.test(trimmed)?'permission':section.kind==='world'||section.kind==='characters'?'world_fact':'unclassified';
   if(mode==='unclassified')continue;
   const conditional=trimmed.match(/(?:如果|一旦|若|当)(.+?)(?:则|就|会|时|，)/);
   rules.push({id:'rule-'+rules.length,mode,sectionId:section.id,sectionKind:section.kind,heading:section.heading,source:trimmed,start,end:start+line.trim().length,...(conditional?{condition:conditional[1].trim(),effect:trimmed.slice(conditional.index!+conditional[0].length).trim()}: {})});
  }
 }
 return rules;
}

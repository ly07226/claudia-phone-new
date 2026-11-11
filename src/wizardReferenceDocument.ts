import type {LongNarrative} from './wizardLongNarrative';
import type {SimulatorRuntimePolicy} from './wizardSimulatorRuntime';
import {indexSimulatorDocument} from './wizardSimulatorDocument';
/** Lossless local index; selected excerpts are data, not an executable simulator declaration. */
export function referenceDocumentPolicy(source:LongNarrative):SimulatorRuntimePolicy {
 const policy:SimulatorRuntimePolicy={sourceId:source.id,sourceName:source.name,simulation:false,referenceOnly:true,publicRules:[],restrictedFacts:[],secretCount:0,secretEvidence:[],reviewedChunks:0};
 const privateText=/秘密|隐瞒|未公开|不知情|隐藏真相|保密|剧透/;
 const restricted=()=>{for(const section of indexSimulatorDocument(source.body))if(privateText.test(section.heading))yieldRange(section.start,section.end);};
 const ranges:{start:number;end:number}[]=[];function yieldRange(start:number,end:number){ranges.push({start,end});}
 restricted();for(const m of source.body.matchAll(/[^\r\n]+/g))if(privateText.test(m[0]))yieldRange(m.index!,m.index!+m[0].length);
 for(const range of ranges){if(ranges.some(other=>other!==range&&other.start<=range.start&&other.end>=range.end&&(other.start<range.start||other.end>range.end)))continue;const quote=source.body.slice(range.start,range.end),terms=[quote,...[...quote.matchAll(/(?:密令|暗号|口令|密码)(?:是|为|[:：=])\s*[“"']?([^。！？；，,\s”"']{2,80})/g)].map(m=>m[1]),...[...quote.matchAll(/[“"]([^”"\r\n]{2,80})[”"]/g)].map(m=>m[1])];policy.secretCount++;policy.secretEvidence.push(...terms);policy.restrictedFacts.push({terms,knownBy:[],revealed:false,start:range.start,end:range.end});}
 for(const paragraph of source.body.matchAll(/[^\r\n]+/g)){
  const start=paragraph.index!,end=start+paragraph[0].length;if(ranges.some(r=>r.start<end&&start<r.end))continue;
  // Split only the reference index, never the archive or saved prose. Full rules are not claimed executable.
  let offset=start;while(offset<end){let next=Math.min(end,offset+1600);if(next<end){const text=source.body.slice(offset,next),boundary=Math.max(text.lastIndexOf('。'),text.lastIndexOf('！'),text.lastIndexOf('？'),text.lastIndexOf('；'));if(boundary>800)next=offset+boundary+1;}policy.publicRules.push({kind:'background',text:source.body.slice(offset,next),sourceStart:offset,sourceEnd:next,certainty:'uninterpreted'});offset=next;}
 }
 return policy;
}

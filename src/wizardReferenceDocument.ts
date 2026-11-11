import type {LongNarrative} from './wizardLongNarrative';
import type {SimulatorRuntimePolicy} from './wizardSimulatorRuntime';
/** Lossless local index; selected excerpts are data, not an executable simulator declaration. */
export function referenceDocumentPolicy(source:LongNarrative):SimulatorRuntimePolicy {
 const policy:SimulatorRuntimePolicy={sourceId:source.id,sourceName:source.name,simulation:false,referenceOnly:true,publicRules:[],restrictedFacts:[],secretCount:0,secretEvidence:[],reviewedChunks:0};
 // Plain imported stories are narrative references, not a disclosure-audit workflow.
 // Preserve the full source in the archive; do not infer secrets from keywords.
 for(const paragraph of source.body.matchAll(/[^\r\n]+/g)){
  const start=paragraph.index!,end=start+paragraph[0].length;
  // Split only the reference index, never the archive or saved prose. Full rules are not claimed executable.
  let offset=start;while(offset<end){let next=Math.min(end,offset+1600);if(next<end){const text=source.body.slice(offset,next),boundary=Math.max(text.lastIndexOf('。'),text.lastIndexOf('！'),text.lastIndexOf('？'),text.lastIndexOf('；'));if(boundary>800)next=offset+boundary+1;}policy.publicRules.push({kind:'background',text:source.body.slice(offset,next),sourceStart:offset,sourceEnd:next,certainty:'uninterpreted'});offset=next;}
 }
 return policy;
}

import {listMemories,memoryTagSnapshot,recordMemoryTagFailure,saveMemoryTags} from './memoryStore';
import type {MemoryScope,MemoryTag} from './memoryTypes';
/** StarHub SPEC §2: full-text input, strict taxonomy, one failure per entry.
 * Provider is injected: never calls a paid API on ordinary chat turns.
 */
export interface TagTaxonomy {emotion:string[];topic:string[]}
export interface TaggingOutput {summary:string;keyword:string[];emotion:string[];topic:string[];person?:string[]}
export type TagProvider=(fullText:string,taxonomy:TagTaxonomy)=>Promise<TaggingOutput>;
export function validateTagging(out:TaggingOutput,taxonomy:TagTaxonomy):MemoryTag[]{
 if(!out||typeof out.summary!=='string'||!out.summary.trim()||out.summary.length>40||/[\r\n]/.test(out.summary)||!Array.isArray(out.keyword)||out.keyword.length>6||!Array.isArray(out.emotion)||!Array.isArray(out.topic)||!Array.isArray(out.person??[]))throw Error('invalid-tagging-output');
 if(!taxonomy||!Array.isArray(taxonomy.emotion)||!Array.isArray(taxonomy.topic))throw Error('invalid-tag-taxonomy');
 const allowedEmotion=new Set(taxonomy.emotion),allowedTopic=new Set(taxonomy.topic);
 if(out.emotion.some(t=>!allowedEmotion.has(t))||out.topic.some(t=>!allowedTopic.has(t)))throw Error('unknown-tag-axis');
 const tags:MemoryTag[]=[];
 for(const [axis,values,weight] of [['keyword',out.keyword,1],['emotion',out.emotion,1],['topic',out.topic,1],['person',out.person??[],1]] as const){
  for(const value of values){
   if(typeof value!=='string'||!value.trim()||value.length>80)throw Error('invalid-tag');
   if(!tags.some(t=>t.axis===axis&&t.tag===value.trim()))tags.push({axis,tag:value.trim(),weight});
  }
 }
 return tags;
}
/** Process at most batchSize untagged visible revisions; failures remain pending.
 * No global last-id watermark: a failed entry cannot be lost behind later ones.
 */
export async function tagPendingMemories(scope:MemoryScope,provider:TagProvider,taxonomy:TagTaxonomy,batchSize=20,manualRetry=false){
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw Error('invalid-batch-size');
 if(!taxonomy||!Array.isArray(taxonomy.emotion)||!Array.isArray(taxonomy.topic)||!taxonomy.emotion.length||!taxonomy.topic.length)throw Error('missing-tag-taxonomy');
 const [all,tags]=await Promise.all([listMemories(scope),memoryTagSnapshot(scope)]);
 const completed=new Set(tags.records.map(t=>t.entryId+':'+t.revision));
 const failures=new Set(tags.failures.map(t=>t.entryId+':'+t.revision));
 // Automatic jobs do not repeatedly bill failed entries. Explicit retry is opt-in.
 const pending=all.entries.filter(e=>!completed.has(e.id+':'+e.revision)&&(manualRetry?failures.has(e.id+':'+e.revision):!failures.has(e.id+':'+e.revision))).slice(0,batchSize);
 let tagged=0,failed=0;
 for(const entry of pending){
  try{
   // Durable in-flight marker before network I/O: an interrupted browser
   // session must not silently issue the same paid request on restart.
   await recordMemoryTagFailure(scope,entry.id,entry.revision,'pending-or-interrupted');
   const output=await provider(entry.content,taxonomy);
   await saveMemoryTags(scope,entry.id,entry.revision,validateTagging(output,taxonomy));
   tagged++;
  }catch(error){
   failed++;
   await recordMemoryTagFailure(scope,entry.id,entry.revision,error instanceof Error?error.name:'UnknownError');
  }
 }
 return {seen:pending.length,tagged,failed,pending:Math.max(0,all.entries.length-tags.records.length-tagged),awaitingManualRetry:tags.failures.length+failed};
}

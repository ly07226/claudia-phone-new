import type Dexie from 'dexie';
import type {Conversation} from './chatTypes';
import type {MemoryScope} from './memoryTypes';
export async function validateMemoryV2Fields(d:Dexie,c:Conversation,valid:(c:Conversation,s:MemoryScope)=>boolean){
 const check=(ok:unknown)=>{if(!ok)throw Error('记忆 V2 的摘要、检查点或时间记录格式/归属无效；原数据未修改。');};
 const str=(v:unknown,max=4096)=>typeof v==='string'&&v.length<=max;
 const fingerprint=(v:unknown)=>v===undefined||typeof v==='string'&&/^(s3:)?[a-f0-9]{64}$/.test(v);
 const scope=async(s:MemoryScope)=>{check(valid(c,s));if(s.mode==='world'){check(s.epoch<=(c.timelineEpoch??0));if(s.epoch===(c.timelineEpoch??0)){const t=await d.table('timelines').get(s.timelineId);check(t&&t.conversationId===c.id&&t.characterId===c.characterId&&t.worldId===c.worldId&&t.epoch===s.epoch);}}};
 const range=(x:{startDay:string;endDay:string})=>{check(/^\d{4}-\d{2}-\d{2}$/.test(x.startDay)&&/^\d{4}-\d{2}-\d{2}$/.test(x.endDay)&&x.startDay<x.endDay&&Number.isFinite(Date.parse(x.startDay))&&Number.isFinite(Date.parse(x.endDay)));};
 if(c.dailyDigestSettings)check(typeof c.dailyDigestSettings.enabled==='boolean'&&[1,2,3,7,14].includes(c.dailyDigestSettings.days));
 if(c.dailyDigests){check(Array.isArray(c.dailyDigests));const ids=new Set<string>();for(const x of c.dailyDigests){check(x&&str(x.id)&&!!x.id&&!ids.has(x.id)&&str(x.text,10000000)&&Number.isFinite(x.createdAt));ids.add(x.id);await scope(x.scope);range(x);check(fingerprint(x.sourceFingerprint));if(x.sourceMessageIds)check(Array.isArray(x.sourceMessageIds)&&x.sourceMessageIds.every(id=>str(id)&&!!id)&&new Set(x.sourceMessageIds).size===x.sourceMessageIds.length);}}
 if(c.memorySummary?.checkpointArchive){check(Array.isArray(c.memorySummary.checkpointArchive)&&c.memorySummary.checkpointArchive.length<=3);for(const archive of c.memorySummary.checkpointArchive){await scope(archive.scope);check(str(archive.timelineId)&&str(archive.throughNodeId)&&Array.isArray(archive.inputs)&&archive.inputs.length<=100&&archive.inputs.every(x=>str(x,100000))&&Array.isArray(archive.completed)&&archive.completed.length<=archive.inputs.length&&Array.isArray(archive.turns)&&archive.turns.length<=100);}}
 const cp=c.dailyDigestCheckpoint;if(cp){await scope(cp.scope);range(cp);check(cp.sourceSignature===undefined||str(cp.sourceSignature,10000000));check(Array.isArray(cp.pieces)&&cp.pieces.every(p=>str(p,10000000))&&Array.isArray(cp.completed)&&cp.completed.length<=cp.pieces.length&&cp.completed.every(p=>str(p,10000000)));}
 if(c.dailyDigestAttempt){await scope(c.dailyDigestAttempt.scope);range(c.dailyDigestAttempt);check(['failed','running'].includes(c.dailyDigestAttempt.status)&&Number.isFinite(c.dailyDigestAttempt.startedAt));}
 if(c.smartTimeMemories){check(Array.isArray(c.smartTimeMemories));for(const x of c.smartTimeMemories){await scope(x.scope);check(str(x.id)&&str(x.title)&&str(x.note,4000));}}
 if(c.dedicatedSummaryApi)check(str(c.dedicatedSummaryApi.apiKey));
}

import {db} from './store';
import {messageFingerprint,timelineSpace} from './timelines';
import type {ConversationSnapshot,Message} from './chatTypes';
/** Expanding one snapshot reads at most 30 bodies, never all saved histories. */
export async function readSnapshotPreview(snapshot:ConversationSnapshot):Promise<Message[]>{
 if(!snapshot.references)return snapshot.messages.slice(-30);
 const ref=snapshot.references;
 if(![2,3].includes(ref.storageVersion)||!snapshot.timelineId||ref.timelineId!==snapshot.timelineId||ref.headNodeId!==snapshot.headNodeId||ref.timelineEpoch!==snapshot.timelineEpoch)throw Error('快照引用无效。');
 return db.transaction('r',[db.conversations,db.timelines,db.pathNodes],async()=>{
  const c=await db.conversations.get(snapshot.conversationId),t=await db.timelines.get(snapshot.timelineId!);
  if(!c||!t||t.conversationId!==c.id||t.characterId!==c.characterId||t.worldId!==c.worldId||t.spaceId!==timelineSpace(c)||t.epoch!==snapshot.timelineEpoch)throw Error('快照不属于此会话。');
  const rows:Message[]=[],seen=new Set<string>();let id=snapshot.headNodeId;
  while(id&&rows.length<30){
   if(seen.has(id))throw Error('快照路径有环。');seen.add(id);
   const node=await db.pathNodes.get(id);
   if(!node||node.conversationId!==c.id||node.messageId!==node.message.id||node.message.conversationId!==c.id||ref.storageVersion===2&&node.messageId!==ref.messageIds[ref.messageIds.length-1-rows.length]||node.fingerprint!==await messageFingerprint(node.message))throw Error('快照来源已失效。');
   rows.push({...node.message,archived:false});id=node.parentNodeId;
  }
  return rows.reverse();
 });
}

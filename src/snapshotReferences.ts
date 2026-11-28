import type {ConversationPathNode,ConversationSnapshot} from './chatTypes';
/** Validate reference metadata against an already verified immutable path.
 * A reference is never permission to read another conversation or live variant. */
export function validateSnapshotReferences(snapshot:ConversationSnapshot,nodes:readonly Pick<ConversationPathNode,'conversationId'|'messageId'|'variantId'>[]){
 const ref=snapshot.references;
 if(!snapshot.timelineId||!ref||![2,3].includes(ref.storageVersion)||
  ref.timelineId!==snapshot.timelineId||ref.headNodeId!==snapshot.headNodeId||ref.timelineEpoch!==snapshot.timelineEpoch||
  snapshot.messages.length||snapshot.variants.length||nodes.some(node=>node.conversationId!==snapshot.conversationId))
  throw Error('快照引用路径已失效，停止恢复。');
 if(ref.storageVersion===3)return;
 if(!Array.isArray(ref.messageIds)||!Array.isArray(ref.variantIds)||ref.messageIds.length!==nodes.length||
  new Set(ref.messageIds).size!==ref.messageIds.length||new Set(ref.variantIds).size!==ref.variantIds.length||
  nodes.some((node,i)=>node.messageId!==ref.messageIds[i]))throw Error('快照引用路径已失效，停止恢复。');
 const variants=[...new Set(nodes.flatMap(node=>node.variantId?[node.variantId]:[]))];
 if(variants.length!==ref.variantIds.length||variants.some((id,i)=>id!==ref.variantIds[i]))
  throw Error('快照引用版本不匹配，停止恢复。');
}

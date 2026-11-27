import {validateSnapshotReferences} from './snapshotReferences';
import {messageBubbles,hasVisiblePart,type BubblePart} from './messageBubbles';
import { ensureTimelineInTransaction, commitTimelineProjection, nodesForHead, messageFingerprint } from "./timelines";
import { db } from "./store";
import { activeMessages, variantsFor } from "./messagePath";
import type {
  Message,
  ConversationSnapshot,
  MessageVariant,
} from "./chatTypes";
/** Local requests are aborted immediately. Persistent tokens also invalidate other tabs. */
const cancellations = new Map<string, { cancel: () => void; token: string }>();
let channel: BroadcastChannel | undefined;
function cancelChannel() {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("claudia-generation-cancel");
    channel.onmessage = (e) => {
      const current = cancellations.get(e.data?.id);
      if (
        e.data?.type === "cancel" &&
        current &&
        current.token === e.data.token
      )
        current.cancel();
    };
  }
  return channel;
}
export function registerGeneration(
  id: string,
  cancel: () => void,
  token: string,
) {
  cancelChannel();
  cancellations.set(id, { cancel, token });
  return () => {
    if (cancellations.get(id)?.cancel === cancel) cancellations.delete(id);
  };
}
export function cancelGeneration(id: string) {
  const local = cancellations.get(id);
  local?.cancel();
  if (local)
    cancelChannel()?.postMessage({ type: "cancel", id, token: local.token });
  else
    void db.conversations
      .get(id)
      .then((c) => {
        if (c?.sendingToken)
          cancelChannel()?.postMessage({
            type: "cancel",
            id,
            token: c.sendingToken,
          });
      })
      .catch(() => {});
}
export const messageTables = () => [
  db.conversations,
  db.messages,
  db.messageVariants,
  db.messageRevisions,
  db.conversationSnapshots,
  db.timelines, db.pathNodes,
];
export async function invalidateGeneration(id: string) {
  const c = await db.conversations.get(id);
  if (!c) throw Error("会话已删除。");
  await db.conversations.update(id, {
    sendingToken: undefined,
    sendingUntil: undefined,
    updatedAt: Date.now(),
  });
}
export async function snapshotPath(
  id: string,
  reason: ConversationSnapshot["reason"],
) {
  const timeline = await ensureTimelineInTransaction(id);
  // New snapshots retain identifiers only. Legacy snapshots remain readable.
  if(timeline.headNodeId){
    const tip=await db.pathNodes.get(timeline.headNodeId);
    if(!tip||tip.conversationId!==id)throw Error('快照头节点缺失或跨会话。');
  }
  const snapshot: ConversationSnapshot = {
    id: crypto.randomUUID(),
    conversationId: id,
    reason,
    timelineId: timeline.id, headNodeId: timeline.headNodeId, timelineEpoch: timeline.epoch,
    createdAt: Date.now(),
    messages: [], variants: [],
    references: { storageVersion: 3, timelineId: timeline.id, headNodeId: timeline.headNodeId, timelineEpoch: timeline.epoch },
  };
  await db.conversationSnapshots.add(snapshot);
  return snapshot;
}
export async function ensureVariant(m: Message): Promise<MessageVariant> {
  if (m.role !== "assistant") throw Error("不是 AI 消息。");
  if (m.activeVariantId) {
    const v = await db.messageVariants.get(m.activeVariantId);
    if (v && v.messageId === m.id && v.conversationId === m.conversationId)
      return v;
  }
  const v: MessageVariant = {
    id: crypto.randomUUID(),
    conversationId: m.conversationId,
    messageId: m.id,
    content: m.content,
    source: "legacy",
    replyInterruption:m.replyInterruption,
    heartVoice:m.heartVoice,
    createdAt: m.createdAt,
  };
  await db.messageVariants.add(v);
  await db.messages.update(m.id, { activeVariantId: v.id });
  return v;
}
async function target(id: string, messageId: string) {
  const rows = await activeMessages(id);
  const index = rows.findIndex((m) => m.id === messageId);
  if (index < 0) throw Error("消息已不在当前有效路径。");
  return { rows, index, message: rows[index], later: rows.slice(index + 1) };
}
async function archiveAfter(
  id: string,
  messageId: string,
  allow: boolean,
  reason: ConversationSnapshot["reason"],
) {
  const t = await target(id, messageId);
  if (t.later.length && !allow)
    throw Error("此消息后仍有聊天，请确认归档后续剧情后再操作。");
  await snapshotPath(id, reason);
  for (const m of t.later) await db.messages.update(m.id, { archived: true });
  return t;
}
export async function selectVariant(
  id: string,
  messageId: string,
  variantId: string,
  allowArchive = false,
) {
  cancelGeneration(id);
  await db.transaction("rw", messageTables(), async () => {
    await ensureTimelineInTransaction(id);
    const t = await target(id, messageId);
    if (t.message.role !== "assistant") throw Error("只有 AI 回复可切换版本。");
    const v = await db.messageVariants.get(variantId);
    if (!v || v.messageId !== messageId || v.conversationId !== id)
      throw Error("版本不存在或不属于此会话。");
    if (t.message.activeVariantId === v.id) return;
    await invalidateGeneration(id);
    if (t.later.length)
      await archiveAfter(id, messageId, allowArchive, "switch");
    await db.messages.update(messageId, {
      activeVariantId: v.id,
      content: v.content,
      userEdited: v.userEdited,
      replyInterruption:v.replyInterruption,
      heartVoice:v.heartVoice,
      bubbleDeletion: undefined,
    });
    await commitTimelineProjection(id,"switch");
  });
}
export async function editMessage(
  id: string,
  messageId: string,
  content: string,
  allowArchive = false,
  expected?: { content: string; activeVariantId?: string },
  expectedPath?: {timelineId?:string;epoch:number},
) {
  content = content.trim();
  if (content.length > 100000)
    throw Error("消息内容需为 1–100000 字符。");
  await db.transaction("rw", messageTables(), async () => {
    if(expectedPath){const c=await db.conversations.get(id);if(!c||c.activeTimelineId!==expectedPath.timelineId||(c.timelineEpoch??0)!==expectedPath.epoch)throw Error("聊天分支已变化，请重新打开编辑器。");}
    cancelGeneration(id);
    await ensureTimelineInTransaction(id);
    const t = await target(id, messageId);
    if(!content&&!t.message.attachments?.length)throw Error("消息不能为空。");
    if (t.message.role !== "user" && t.message.role !== "assistant")
      throw Error("此消息不可编辑。");
    if (t.message.role === "user" && content.length > 8000)
      throw Error("用户消息最多 8000 字符。");
    if (
      expected &&
      (t.message.content !== expected.content ||
        t.message.activeVariantId !== expected.activeVariantId)
    )
      throw Error("消息已在其他操作中变化，请重新打开编辑器。");
    await invalidateGeneration(id);
    await archiveAfter(id, messageId, allowArchive, "edit");
    const variant =
      t.message.role === "assistant"
        ? await ensureVariant(t.message)
        : undefined;
    await db.messageRevisions.add({
      id: crypto.randomUUID(),
      conversationId: id,
      messageId,
      variantId: variant?.id,
      content: t.message.content,
      createdAt: Date.now(),
    });
    if (variant)
      await db.messageVariants.update(variant.id, {
        content,
        userEdited: true,
        heartVoice:undefined,
        replyInterruption:undefined,
      });
    await db.messages.update(messageId, { content, heartVoice:undefined, userEdited: true, bubbleDeletion:undefined,replyInterruption:undefined });
    await commitTimelineProjection(id,"edit");
  });
}
export async function removeMessage(
  id: string,
  messageId: string,
  kind: "delete" | "withdraw",
  allowArchive = false,
) {
  cancelGeneration(id);
  let content = "";
  await db.transaction("rw", messageTables(), async () => {
    await ensureTimelineInTransaction(id);
    const t = await target(id, messageId);
    if (
      kind === "withdraw" &&
      (t.message.role !== "user" ||
        t.rows.filter((m) => m.role === "user").at(-1)?.id !== messageId)
    )
      throw Error("只能撤回当前有效路径的最新用户消息。");
    await invalidateGeneration(id);
    await archiveAfter(id, messageId, allowArchive, kind);
    await db.messages.update(messageId, { archived: true });
    content = t.message.content;
    await commitTimelineProjection(id,kind);
  });
  return content;
}
export async function restoreSnapshot(id: string, snapshotId: string) {
  cancelGeneration(id);
  await db.transaction("rw", messageTables(), async () => {
    await ensureTimelineInTransaction(id);
    const s = await db.conversationSnapshots.get(snapshotId);
    if (!s || s.conversationId !== id)
      throw Error("快照不属于此会话或已不存在。");
    // Rehydrate reference snapshots from the immutable path. Never silently
    // fall back to current live messages when a referenced node is missing.
    let snapshotMessages = s.messages;
    let snapshotVariants = s.variants;
    if (s.references) {
      const nodes = await nodesForHead(id, s.headNodeId);
      validateSnapshotReferences(s,nodes);
      snapshotMessages = nodes.map(n => ({ ...n.message, archived: false }));
      const versionNodes=nodes.filter(n=>!!n.variantId);
      const variants=await db.messageVariants.bulkGet(versionNodes.map(n=>n.variantId!));
      if(variants.some((v,i)=>!v||v.conversationId!==id||v.messageId!==versionNodes[i].messageId))
        throw Error("快照引用版本缺失，停止恢复。");
      // Variant rows are mutable (editing reuses their ID). The verified
      // immutable path, not the present-day variant value, owns saved text.
      snapshotVariants=versionNodes.map((n,i)=>({...variants[i]!,content:n.message.content,userEdited:n.message.userEdited,heartVoice:n.message.heartVoice,replyInterruption:n.message.replyInterruption}));
    }
    const ids = new Set(snapshotMessages.map((m) => m.id));
    if (
      snapshotMessages.some((m) => m.conversationId !== id) ||
      snapshotVariants.some((v) => v.conversationId !== id || !ids.has(v.messageId))
    )
      throw Error("快照关联不合法。");
    for (const m of snapshotMessages) {
      const existing = await db.messages.get(m.id);
      if (existing && existing.conversationId !== id)
        throw Error("快照消息关联不合法。");
    }
    for (const v of snapshotVariants) {
      const existing = await db.messageVariants.get(v.id);
      if (
        existing &&
        (existing.conversationId !== id || existing.messageId !== v.messageId)
      )
        throw Error("快照版本关联不合法。");
    }
    if(s.timelineId){
      const source=await db.timelines.get(s.timelineId),c=await db.conversations.get(id);
      if(!source||source.conversationId!==id||source.epoch!==c?.timelineEpoch||s.timelineEpoch!==source.epoch)throw Error("快照时间线关联已失效。");
      if(s.headNodeId&&!(await nodesForHead(id,source.headNodeId)).some(n=>n.id===s.headNodeId))throw Error("快照不属于声明的时间线路径。");
      const saved=await nodesForHead(id,s.headNodeId);
      if(saved.length!==snapshotMessages.length)throw Error("快照路径不匹配。");
      for(let i=0;i<saved.length;i++)if(saved[i].fingerprint!==await messageFingerprint(snapshotMessages[i]))throw Error("快照内容与不可变路径不匹配。");
    }
    await invalidateGeneration(id);
    await snapshotPath(id, "restore");
    await db.messages
      .where("conversationId")
      .equals(id)
      .modify({ archived: true });
    await db.messageVariants.bulkPut(snapshotVariants);
    await db.messages.bulkPut(
      snapshotMessages.map((m) => ({ ...m, archived: false })),
    );
    if(s.timelineId)await db.conversations.update(id,{activeTimelineId:s.timelineId});
    await commitTimelineProjection(id,"restore",!s.timelineId);
  });
}
export async function restoreRevision(
  id: string,
  revisionId: string,
  allowArchive = false,
) {
  const r = await db.messageRevisions.get(revisionId);
  if (!r || r.conversationId !== id) throw Error("修订不属于此会话。");
  const m = await db.messages.get(r.messageId);
  if (!m || m.archived) throw Error("请先恢复包含此消息的历史分支。");
  if (r.variantId && m.activeVariantId !== r.variantId)
    throw Error("请先切换到该修订对应的 AI 版本。");
  await editMessage(id, r.messageId, r.content, allowArchive, {
    content: m.content,
    activeVariantId: m.activeVariantId,
  });
}
export async function addGeneratedVariant(m: Message, content: string, replyInterruption?: import("./chatCompletion").ReplyInterruption, heartVoice?:string) {
  const previous = await variantsFor(m);
  const v: MessageVariant = {
    id: crypto.randomUUID(),
    conversationId: m.conversationId,
    messageId: m.id,
    content,
    source: "generated",
    heartVoice,
    replyInterruption,
    createdAt: Math.max(Date.now(), ...previous.map((v) => v.createdAt + 1)),
  };
  await db.messageVariants.add(v);
  await db.messages.update(m.id, {
    activeVariantId: v.id,
    content,
    heartVoice,
    userEdited: false,
    replyInterruption,
    bubbleDeletion: undefined,
  });
  return v;
}

/** Branch-local tombstones: never mutate a variant or archive following messages. */
export async function deleteBubble(id:string,messageId:string,part:BubblePart,expected:{timelineId?:string;epoch:number},base:{content:string;activeVariantId?:string}){
 await db.transaction('rw',messageTables(),async()=>{
  const c=await db.conversations.get(id);
  if(!c||c.activeTimelineId!==expected.timelineId||(c.timelineEpoch??0)!==expected.epoch)throw Error('聊天分支已变化，请重新长按消息。');
  await ensureTimelineInTransaction(id);const t=await target(id,messageId),m=t.message;
  if(!['user','assistant'].includes(m.role)||m.content!==base.content||m.activeVariantId!==base.activeVariantId||!hasVisiblePart(m,part))throw Error('消息或气泡已变化，未删除其他内容。');
  cancelGeneration(id);await invalidateGeneration(id);await snapshotPath(id,'delete');
  const previous=m.bubbleDeletion||{variantId:m.activeVariantId,text:[],images:[]};
  const bubbleDeletion={...previous,text:[...previous.text,...(part.kind==='text'?[part]:[])],images:[...previous.images,...(part.kind==='image'?[part.assetId]:[])]};
  const next={...m,bubbleDeletion};await db.messages.update(m.id,{bubbleDeletion,archived:!messageBubbles(next).length});
  await commitTimelineProjection(id,'delete');
 });
}

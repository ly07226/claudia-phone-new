import {visibleMessage} from './messageBubbles';
import { db } from "./store";
import {latestTimelineMessage} from "./timelines";
export interface ChatPreview { content: string; createdAt?: number; remark?: string; pinned?: boolean; pinnedAt?: number; unread?: boolean; conversationId: string }
/** Read-only display projection of the current space's active branch. */
export async function chatListPreviews(characterIds: string[], worldId?: string) {
  const allowed = new Set(characterIds);
  const conversations = (await db.conversations.where("characterId").anyOf(characterIds).toArray())
    .filter(c => allowed.has(c.characterId) && (worldId ? c.mode === "world" && c.worldId === worldId : c.mode === "daily"))
    .sort((a,b) => b.updatedAt-a.updatedAt || a.id.localeCompare(b.id));
  const result: Record<string, ChatPreview> = {};
  for (const c of conversations) {
    if (result[c.characterId]) continue;
    let last:ReturnType<typeof visibleMessage>|undefined;
    if(c.activeTimelineId){const m=await latestTimelineMessage(c);if(m)last=visibleMessage(m);}
    else {const m=await db.messages.where('[conversationId+createdAt]').between([c.id,-Infinity],[c.id,Infinity]).reverse().filter(m=>!m.archived&&(m.role==='user'||m.role==='assistant')).first();if(m){const v=m.role==='assistant'&&m.activeVariantId?await db.messageVariants.get(m.activeVariantId):undefined;last=visibleMessage(v&&v.conversationId===c.id&&v.messageId===m.id?{...m,content:v.content,userEdited:v.userEdited}:m);}}
    result[c.characterId] = { conversationId: c.id, remark: c.chatSettings?.remark, pinned: c.chatSettings?.pinned, pinnedAt: c.chatSettings?.pinnedAt, unread: !!c.chatSettings?.proactiveUnreadAt, content: last?.content.replace(/\s+/g, " ").trim() || (last?.attachments?.length?"[图片]":""), createdAt: last?.createdAt };
  }
  return result;
}
export function chatPreviewTime(timestamp: number) {
  const date = new Date(timestamp), now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

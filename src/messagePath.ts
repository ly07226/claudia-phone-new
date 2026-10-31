import { legacyActiveMessages } from "./legacyMessagePath";
import { resolveTimelinePath } from "./timelines";
import { db } from "./store";
import type { Message, MessageVariant } from "./chatTypes";
export async function activeMessages(
  conversationId: string,
  beforeId?: string,
): Promise<Message[]> {
  const c = await db.conversations.get(conversationId);
  const rows = c?.activeTimelineId ? await resolveTimelinePath(conversationId, c.activeTimelineId) : await legacyActiveMessages(conversationId);
  if (!beforeId) return rows;
  const index=rows.findIndex(m=>m.id===beforeId);
  if(index<0)throw Error("目标消息不在当前有效路径。");
  return rows.slice(0,index);
}

export async function variantsFor(message: Message) {
  const rows = await db.messageVariants
    .where("messageId")
    .equals(message.id)
    .filter((v) => v.conversationId === message.conversationId)
    .toArray();
  return rows.sort(
    (a, b) =>
      a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

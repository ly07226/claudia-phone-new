import { db } from "./store";
import type { Message, MessageVariant } from "./chatTypes";
export async function activeMessages(
  conversationId: string,
  beforeId?: string,
): Promise<Message[]> {
  const rows = (
    await db.messages
      .where("conversationId")
      .equals(conversationId)
      .filter((m) => !m.archived)
      .toArray()
  ).sort(
    (a, b) =>
      a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let selected = rows;
  if (beforeId) {
    const index = rows.findIndex((m) => m.id === beforeId);
    if (index < 0) throw Error("目标消息不在当前有效路径。");
    selected = rows.slice(0, index);
  }
  const ids = selected
    .filter((m) => m.role === "assistant" && m.activeVariantId)
    .map((m) => m.activeVariantId!);
  const variants = await db.messageVariants.bulkGet(ids);
  const byId = new Map(
    variants.filter((v): v is MessageVariant => !!v).map((v) => [v.id, v]),
  );
  return selected.map((m) => {
    const v = m.activeVariantId ? byId.get(m.activeVariantId) : undefined;
    return v && v.conversationId === conversationId && v.messageId === m.id
      ? { ...m, content: v.content, userEdited: v.userEdited }
      : m;
  });
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

import { db } from "./store";
import { activeMessages } from "./messagePath";
export interface ChatPreview { content: string; createdAt?: number; remark?: string; pinned?: boolean; pinnedAt?: number; conversationId: string }
/** Read-only display projection of the current space's active branch. */
export async function chatListPreviews(characterIds: string[], worldId?: string) {
  const allowed = new Set(characterIds);
  const conversations = (await db.conversations.toArray())
    .filter(c => allowed.has(c.characterId) && (worldId ? c.mode === "world" && c.worldId === worldId : c.mode === "daily"))
    .sort((a,b) => b.updatedAt-a.updatedAt || a.id.localeCompare(b.id));
  const result: Record<string, ChatPreview> = {};
  for (const c of conversations) {
    if (result[c.characterId]) continue;
    const last = (await activeMessages(c.id)).filter(m => m.role === "user" || m.role === "assistant").at(-1);
    result[c.characterId] = { conversationId: c.id, remark: c.chatSettings?.remark, pinned: c.chatSettings?.pinned, pinnedAt: c.chatSettings?.pinnedAt, content: last?.content.replace(/\s+/g, " ").trim() || "", createdAt: last?.createdAt };
  }
  return result;
}
export function chatPreviewTime(timestamp: number) {
  const date = new Date(timestamp), now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

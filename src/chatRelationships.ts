import { db, type Character } from "./store";
import { searchableMessages } from "./chatPreferences";
import { cancelGeneration, messageTables } from "./messageOperations";
import { clearLoreTrace } from "./loreDiagnostics";
import type { DailyFriendship } from "./friendTypes";
export const reapplyDelay = 24 * 60 * 60 * 1000;
export function isDailyFriend(character: Pick<Character, "dailyFriendship">) {
  return !character.dailyFriendship || character.dailyFriendship.status === "friend";
}
/** Deliberately conservative local policy, never an AI judgment or random decision. */
export function canReapply(character: Character, now: number) {
  const f = character.dailyFriendship;
  return f?.status === "deleted" && f.deletion?.by === "user" &&
    Number.isFinite(f.deletion.at) && now - f.deletion.at >= reapplyDelay &&
    !f.application && !!character.persona.trim();
}
export async function clearChatHistory(id: string) {
  cancelGeneration(id);
  await db.transaction("rw", messageTables(), async () => {
    const c = await db.conversations.get(id);
    if (!c) throw Error("会话已不存在，未清空任何记录。");
    // No summary or long-term memory store exists in v5. Never delete persona/lore.
    for (const table of [db.messages, db.messageVariants, db.messageRevisions, db.conversationSnapshots])
      await table.where("conversationId").equals(id).delete();
    await db.conversations.update(id, {sendingToken: undefined, sendingUntil: undefined, updatedAt: Date.now()});
  });
  clearLoreTrace(id);
}
export async function deleteDailyFriend(conversationId: string, now = Date.now()) {
  await db.transaction("rw", [db.characters, db.conversations], async () => {
    const c = await db.conversations.get(conversationId);
    if (!c || c.mode !== "daily" || c.worldId) throw Error("删除好友仅适用于日常聊天，不改变世界关联。");
    const character = await db.characters.get(c.characterId);
    if (!character) throw Error("角色不存在。");
    if (!isDailyFriend(character)) throw Error("该角色已不是当前好友，未重复创建删除事件。");
    cancelGeneration(conversationId);
    const friendship: DailyFriendship = {status: "deleted", deletion: {id: crypto.randomUUID(), at: now, by: "user"}};
    await db.characters.update(character.id, {dailyFriendship: friendship});
    await db.conversations.update(c.id, {sendingToken: undefined, sendingUntil: undefined});
  });
}
/** Called on entering the daily list. Atomic state transition also deduplicates tabs/StrictMode. */
export async function checkDailyFriendApplications(now = Date.now()) {
  return db.transaction("rw", [db.characters, db.conversations, db.messages, db.messageVariants], async () => {
    const candidates = (await db.characters.toArray()).filter(c => canReapply(c, now));
    let created = 0;
    for (const character of candidates) {
      const scopeKey = JSON.stringify([character.id, "daily", ""]);
      const c = await db.conversations.where("scopeKey").equals(scopeKey).first();
      if (!c || c.mode !== "daily" || c.worldId || c.characterId !== character.id) continue;
      const rows = await searchableMessages(c.id);
      if (!rows.some(m => m.role === "user" && m.content.trim()) || !rows.some(m => m.role === "assistant" && m.content.trim())) continue;
      const f = character.dailyFriendship!;
      await db.characters.update(character.id, {dailyFriendship: {...f, status: "pending", application: {
        id: crypto.randomUUID(), deletionId: f.deletion!.id, createdAt: now,
        reason: "希望重新建立联系，继续之前的对话。", source: "local-rule",
      }}});
      created++;
    }
    return created;
  });
}
export async function respondToFriendApplication(characterId: string, applicationId: string, accept: boolean) {
  await db.transaction("rw", db.characters, async () => {
    const c = await db.characters.get(characterId), f = c?.dailyFriendship;
    if (!c || f?.status !== "pending" || !f.deletion || f.application?.id !== applicationId || f.application.deletionId !== f.deletion.id)
      throw Error("此申请已处理或已失效，请刷新列表。");
    await db.characters.update(c.id, {dailyFriendship: {...f, status: accept ? "friend" : "rejected", application: {...f.application, resolvedAt: Date.now()}}});
  });
}

import { db } from "./store";
import type { Conversation } from "./chatTypes";
import { buildContext, contextLimits } from "./chatContext";
import { requestReply } from "./chatProvider";
export async function getConversation(characterId: string, worldId?: string) {
  return db.transaction(
    "rw",
    [db.conversations, db.characters, db.worlds, db.worldProfiles],
    async () => {
      if (!(await db.characters.get(characterId))) throw Error("角色不存在。");
      if (
        worldId &&
        (!(await db.worlds.get(worldId)) ||
          !(await db.worldProfiles
            .where("[worldId+characterId]")
            .equals([worldId, characterId])
            .first()))
      )
        throw Error("请先关联此世界与角色。");
      const scopeKey = JSON.stringify([
        characterId,
        worldId ? "world" : "daily",
        worldId || "",
      ]);
      let c = await db.conversations.where("scopeKey").equals(scopeKey).first();
      if (!c) {
        const now = Date.now();
        c = {
          id: crypto.randomUUID(),
          scopeKey,
          characterId,
          mode: worldId ? "world" : "daily",
          ...(worldId ? { worldId } : {}),
          createdAt: now,
          updatedAt: now,
        };
        await db.conversations.add(c);
      }
      return c;
    },
  );
}
export async function resolveApi(c: Conversation) {
  const character = await db.characters.get(c.characterId);
  const id = c.apiConfigId || character?.apiConfigId;
  const config = id
    ? await db.apiConfigs.get(id)
    : await db.apiConfigs.filter((a) => a.enabled && a.isDefault).first();
  if (!config?.enabled)
    throw Error(
      "没有可用 API，或指定配置已删除/停用。请前往设置 → AI / API 设置，或更改当前配置。",
    );
  const credential = await db.apiCredentials.get(config.id);
  if (!credential?.apiKey)
    throw Error("API 缺少凭据，请前往设置 → AI / API 设置。");
  return { config, key: credential.apiKey };
}
const recentRequests: number[] = [];
export async function sendMessage(
  id: string,
  text: string,
  signal?: AbortSignal,
  retry = false,
  onSaved?: () => Promise<void>,
) {
  if (!retry && (!text.trim() || text.length > contextLimits.userChars))
    throw Error("请输入 1–8000 字符。");
  const now = Date.now();
  while (recentRequests.length && recentRequests[0] < now - 60000)
    recentRequests.shift();
  if (recentRequests.length >= 20)
    throw Error("本浏览器请求过于频繁，请稍后再试（每分钟最多 20 次）。");
  recentRequests.push(now);
  const token = crypto.randomUUID();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 60000);
  let acquired = false;
  try {
    const c = await db.transaction(
      "rw",
      [db.conversations, db.messages],
      async () => {
        const c = await db.conversations.get(id);
        if (!c) throw Error("会话已删除。");
        if (c.sendingUntil && c.sendingUntil > Date.now())
          throw Error("此会话正在回复中，请稍候。");
        const last = await db.messages
          .where("[conversationId+createdAt]")
          .between([id, -Infinity], [id, Infinity])
          .last();
        if (retry && last?.role !== "user")
          throw Error("没有可重试的用户消息。");
        const now = Math.max(Date.now(), (last?.createdAt || 0) + 1);
        if (!retry)
          await db.messages.add({
            id: crypto.randomUUID(),
            conversationId: id,
            role: "user",
            content: text.trim(),
            createdAt: now,
          });
        await db.conversations.update(id, {
          sendingToken: token,
          sendingUntil: Date.now() + 90000,
          updatedAt: now,
        });
        return c;
      },
    );
    acquired = true;
    await onSaved?.();
    const { config, key } = await resolveApi(c);
    const context = await buildContext(c);
    if (controller.signal.aborted) throw Error("请求已取消，用户消息已保留。");
    const reply = await requestReply(config, key, context, controller.signal);
    if (controller.signal.aborted) throw Error("请求已取消，用户消息已保留。");
    await db.transaction("rw", [db.conversations, db.messages], async () => {
      const current = await db.conversations.get(id);
      if (!current || current.sendingToken !== token) return;
      const last = await db.messages
        .where("[conversationId+createdAt]")
        .between([id, -Infinity], [id, Infinity])
        .last();
      const now = Math.max(Date.now(), (last?.createdAt || 0) + 1);
      await db.messages.add({
        id: crypto.randomUUID(),
        conversationId: id,
        role: "assistant",
        content: reply,
        createdAt: now,
      });
      await db.conversations.update(id, { updatedAt: now });
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    if (acquired)
      await db.transaction("rw", db.conversations, async () => {
        const c = await db.conversations.get(id);
        if (c?.sendingToken === token)
          await db.conversations.update(id, {
            sendingToken: undefined,
            sendingUntil: undefined,
          });
      });
  }
}
export async function deleteConversation(id: string) {
  await db.transaction("rw", [db.conversations, db.messages], async () => {
    await db.messages.where("conversationId").equals(id).delete();
    await db.conversations.delete(id);
  });
}
export async function deleteWorld(id: string) {
  await db.transaction(
    "rw",
    [db.worlds, db.worldProfiles, db.conversations, db.messages],
    async () => {
      const conversations = await db.conversations
        .where("worldId")
        .equals(id)
        .toArray();
      for (const c of conversations)
        await db.messages.where("conversationId").equals(c.id).delete();
      await db.conversations.where("worldId").equals(id).delete();
      await db.worldProfiles.where("worldId").equals(id).delete();
      await db.worlds.delete(id);
    },
  );
}
export async function deleteCharacter(id: string) {
  await db.transaction(
    "rw",
    [db.characters, db.worldProfiles, db.conversations, db.messages],
    async () => {
      const conversations = await db.conversations
        .where("characterId")
        .equals(id)
        .toArray();
      for (const c of conversations)
        await db.messages.where("conversationId").equals(c.id).delete();
      await db.conversations.where("characterId").equals(id).delete();
      await db.worldProfiles.where("characterId").equals(id).delete();
      await db.characters.delete(id);
    },
  );
}

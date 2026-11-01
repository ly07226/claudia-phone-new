import { ensureTimelineInTransaction, commitTimelineProjection, timelineTables } from "./timelines";
import { reconcileApiDefault, usableApi } from "./apiSelection";
import { activeMessages } from "./messagePath";
import {
  registerGeneration,
  cancelGeneration,
  messageTables,
  snapshotPath,
  ensureVariant,
  addGeneratedVariant,
} from "./messageOperations";
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
    : (await reconcileApiDefault()).config;
  if (!config?.enabled)
    throw Error(
      "没有可用 API，或指定配置已删除/停用。请前往设置 → AI / API 设置，或更改当前配置。",
    );
  const credential = await db.apiCredentials.get(config.id);
  if (!credential?.apiKey)
    throw Error("API 缺少凭据，请前往设置 → AI / API 设置。");
  if (!usableApi(config, credential.apiKey))
    throw Error("指定 API 配置字段不完整或协议不支持，请前往设置 → AI / API 设置检查。未更改角色或会话绑定。");
  return { config, key: credential.apiKey };
}
const recentRequests: number[] = [];
export interface ExpectedPath { timelineId?: string; epoch: number }
export async function sendMessage(
  id: string,
  text: string,
  signal?: AbortSignal,
  retry = false,
  onSaved?: () => Promise<void>,
  expectedPath?: ExpectedPath,
) {
  if (!retry && (!text.trim() || text.length > contextLimits.userChars))
    throw Error("请输入 1–8000 字符。");
  return generate(id, { text, retry, onSaved, expectedPath }, signal);
}
/** Save to the same immutable active path, without starting a model request. */
export async function queueUserMessage(id:string,text:string,expectedPath?:ExpectedPath) {
  if(!text.trim() || text.length>contextLimits.userChars)throw Error("请输入 1–8000 字符。");
  await db.transaction("rw",timelineTables(),async()=>{
    const c=await db.conversations.get(id);
    if(!c)throw Error("会话已删除。");
    if(!c.chatSettings?.continuousSend)throw Error("连续发送模式已关闭，请重新确认后发送。");
    if(expectedPath&&(c.activeTimelineId!==expectedPath.timelineId||(c.timelineEpoch??0)!==expectedPath.epoch))throw Error("剧情已在其他窗口切换，请确认当前消息后重试。");
    if(c.sendingUntil&&c.sendingUntil>Date.now())throw Error("此会话正在回复中，请稍候。");
    await ensureTimelineInTransaction(id);
    const last=(await activeMessages(id)).at(-1);
    await db.messages.add({id:crypto.randomUUID(),conversationId:id,role:"user",content:text.trim(),createdAt:Math.max(Date.now(),(last?.createdAt||0)+1)});
    await commitTimelineProjection(id,"append");
    await db.conversations.update(id,{updatedAt:Date.now()});
  });
}
export async function regenerateMessage(
  id: string,
  messageId: string,
  signal?: AbortSignal,
  allowArchive = false,
  expectedPath?: ExpectedPath,
) {
  return generate(id, { messageId, allowArchive, expectedPath }, signal);
}
interface GenerateOptions {
  expectedPath?: ExpectedPath;
  text?: string;
  retry?: boolean;
  onSaved?: () => Promise<void>;
  messageId?: string;
  allowArchive?: boolean;
}
async function generate(
  id: string,
  options: GenerateOptions,
  signal?: AbortSignal,
) {
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
  let release = () => {};
  try {
    const c = await db.transaction(
      "rw",
      timelineTables(),
      async () => {
        const c = await db.conversations.get(id);
        if (!c) throw Error("会话已删除。");
        if(options.expectedPath&&(c.activeTimelineId!==options.expectedPath.timelineId||(c.timelineEpoch??0)!==options.expectedPath.epoch))throw Error("剧情已在其他窗口切换，请确认当前消息后重试。");
        if (c.sendingUntil && c.sendingUntil > Date.now())
          throw Error("此会话正在回复中，请稍候。");
        await ensureTimelineInTransaction(id);
        const rows = await activeMessages(id);
        const last = rows.at(-1);
        if (options.messageId) {
          const index = rows.findIndex(
            (m) => m.id === options.messageId && m.role === "assistant",
          );
          if (index < 0) throw Error("目标 AI 回复不在当前有效路径。");
          if (index < rows.length - 1 && !options.allowArchive)
            throw Error("重新生成历史回复前请确认归档后续剧情。");
        } else {
          if (options.retry && last?.role !== "user")
            throw Error("没有可重试的用户消息。");
          if (!options.retry)
            await db.messages.add({
              id: crypto.randomUUID(),
              conversationId: id,
              role: "user",
              content: options.text!.trim(),
              createdAt: Math.max(Date.now(), (last?.createdAt || 0) + 1),
            });
        }
        if(!options.messageId && !options.retry)await commitTimelineProjection(id,"append");
        await db.conversations.update(id, {
          sendingToken: token,
          sendingUntil: Date.now() + 90000,
          updatedAt: Date.now(),
        });
        return (await db.conversations.get(id))!;
      },
    );
    acquired = true;
    release = registerGeneration(id, abort, token);
    await options.onSaved?.();
    const { config, key } = await resolveApi(c);
    const context = await buildContext(c, options.messageId);
    if (
      controller.signal.aborted ||
      (await db.conversations.get(id))?.sendingToken !== token
    )
      throw Error("请求已取消，原消息和版本已保留。");
    const reply = await requestReply(config, key, context, controller.signal);
    if (controller.signal.aborted)
      throw Error("请求已取消，原消息和版本已保留。");
    await db.transaction("rw", messageTables(), async () => {
      const current = await db.conversations.get(id);
      if (
        !current ||
        current.sendingToken !== token ||
        current.activeTimelineId !== c.activeTimelineId || current.timelineEpoch !== c.timelineEpoch ||
        controller.signal.aborted
      )
        return;
      const rows = await activeMessages(id);
      if (options.messageId) {
        const index = rows.findIndex(
          (m) => m.id === options.messageId && m.role === "assistant",
        );
        if (index < 0) return;
        const m = rows[index];
        if (index < rows.length - 1) {
          if (!options.allowArchive)
            throw Error("后续剧情已变化，请重新确认。");
          await snapshotPath(id, "regenerate");
          for (const later of rows.slice(index + 1))
            await db.messages.update(later.id, { archived: true });
        }
        await ensureVariant(m);
        await addGeneratedVariant(m, reply);
      } else {
        const last = rows.at(-1);
        const m = {
          id: crypto.randomUUID(),
          conversationId: id,
          role: "assistant" as const,
          content: reply,
          createdAt: Math.max(Date.now(), (last?.createdAt || 0) + 1),
        };
        await db.messages.add(m);
        await addGeneratedVariant(m, reply);
      }
      await commitTimelineProjection(id,options.messageId?"regenerate":"append");
      await db.conversations.update(id, { updatedAt: Date.now() });
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    release();
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
async function purgeRecords(id: string) {
  cancelGeneration(id);
  await db.pathNodes.where("conversationId").equals(id).delete();
  await db.timelines.where("conversationId").equals(id).delete();
  await db.messages.where("conversationId").equals(id).delete();
  await db.messageVariants.where("conversationId").equals(id).delete();
  await db.messageRevisions.where("conversationId").equals(id).delete();
  await db.conversationSnapshots.where("conversationId").equals(id).delete();
}
export async function deleteConversation(id: string) {
  await db.transaction("rw", messageTables(), async () => {
    await purgeRecords(id);
    await db.conversations.delete(id);
  });
}
export async function deleteWorld(id: string) {
  await db.transaction(
    "rw",
    [db.worlds, db.worldProfiles, ...messageTables()],
    async () => {
      const conversations = await db.conversations
        .where("worldId")
        .equals(id)
        .toArray();
      for (const c of conversations) await purgeRecords(c.id);
      await db.conversations.where("worldId").equals(id).delete();
      await db.worldProfiles.where("worldId").equals(id).delete();
      await db.worlds.delete(id);
    },
  );
}
export async function deleteCharacter(id: string) {
  await db.transaction(
    "rw",
    [db.characters, db.worldProfiles, ...messageTables()],
    async () => {
      const conversations = await db.conversations
        .where("characterId")
        .equals(id)
        .toArray();
      for (const c of conversations) await purgeRecords(c.id);
      await db.conversations.where("characterId").equals(id).delete();
      await db.worldProfiles.where("characterId").equals(id).delete();
      await db.characters.delete(id);
    },
  );
}

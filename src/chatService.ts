import {emptySummaryState} from './memorySummaryTypes';
import {notifyAssistantReplyCommitted} from './memorySummaryScheduler';
import {publishSavedChatMessage} from './chatMessageEvents';
import {stripLeakedTimeMarkers} from './timeMarkerSanitizer';
import {appendContinuation,validInterruption} from './chatCompletion';
import type {Message} from './chatTypes';
import {assertQuoteForSend} from './messageReferences';
import { attachmentImages, attachmentIds } from "./imageAttachments";
import { assertImageProvider } from "./chatProvider";
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
import type { Conversation, MessageQuote } from "./chatTypes";
import { buildContext, contextLimits } from "./chatContext";
import { requestReply,requestChatReply } from "./chatProvider";
/** Separate authored roleplay inner voice from the visible reply in the SAME model call. */
const HEART_OPEN='[心声]';
const HEART_CLOSE='[/心声]';
export function parseHeartVoice(raw:string){
 const start=raw.lastIndexOf(HEART_OPEN),end=raw.lastIndexOf(HEART_CLOSE);
 // An incomplete metadata block must never become a visible character reply.
 if(start<0)return {text:raw.replaceAll(HEART_CLOSE,''),heartVoice:undefined};
 if(end<start)return {text:raw.slice(0,start).replaceAll(HEART_CLOSE,'').trim(),heartVoice:undefined};
 const voice=raw.slice(start+HEART_OPEN.length,end).trim();
 const text=(raw.slice(0,start)+raw.slice(end+HEART_CLOSE.length)).replaceAll(HEART_OPEN,'').replaceAll(HEART_CLOSE,'').trim();
 if(!text)return {text:'',heartVoice:undefined};
 return {text,heartVoice:voice?voice.slice(0,3000):undefined};
}
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
          memorySummary: emptySummaryState(),
        };
        await db.conversations.add(c);
      }
      // Migrate only conversations with no summary state; preserve explicit opt-outs.
      if(!c.memorySummary){
        const memorySummary=emptySummaryState();
        await db.conversations.update(c.id,{memorySummary});
        c={...c,memorySummary};
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
  onSaved?: (path:ExpectedPath) => Promise<void>,
  expectedPath?: ExpectedPath,
  images: string[] = [],
  replyTo?: MessageQuote,
) {
  attachmentIds({attachments:images.map(assetId=>({assetId}))});
  if(images.length&&!retry){const c=await db.conversations.get(id);if(!c)throw Error("会话已删除。");assertImageProvider((await resolveApi(c)).config);}
  if (!retry && ((!text.trim()&&!images.length) || text.length > contextLimits.userChars))
    throw Error("请输入 1–8000 字符。");
  return generate(id, { text, retry, onSaved, expectedPath, images, replyTo }, signal);
}
/** Save to the same immutable active path, without starting a model request. */
export async function queueUserMessage(id:string,text:string,expectedPath?:ExpectedPath,images:string[]=[],replyTo?:MessageQuote) {
  attachmentIds({attachments:images.map(assetId=>({assetId}))});
  if((!text.trim()&&!images.length) || text.length>contextLimits.userChars)throw Error("请输入 1–8000 字符。");
  await db.transaction("rw",[...timelineTables(),db.assets],async()=>{
    const c=await db.conversations.get(id);
    if(!c)throw Error("会话已删除。");
    if(!c.chatSettings?.continuousSend)throw Error("连续发送模式已关闭，请重新确认后发送。");
    if(expectedPath&&(c.activeTimelineId!==expectedPath.timelineId||(c.timelineEpoch??0)!==expectedPath.epoch))throw Error("剧情已在其他窗口切换，请确认当前消息后重试。");
    if(c.sendingUntil&&c.sendingUntil>Date.now())throw Error("此会话正在回复中，请稍候。");
    await storeImageReferences(c,images);
    await ensureTimelineInTransaction(id);
    const rows=await activeMessages(id,undefined,true);
    if(replyTo)await assertQuoteForSend(replyTo,(await db.conversations.get(id))!,rows);
    const last=rows.at(-1);
    await db.messages.add({id:crypto.randomUUID(),conversationId:id,role:"user",content:text.trim(),...(replyTo?{replyTo}:{}),...(images.length?{attachments:images.map(assetId=>({assetId}))}:{}),createdAt:Math.max(Date.now(),(last?.createdAt||0)+1)});
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
  onSaved?: (path:ExpectedPath) => Promise<void>,
) {
  return generate(id, { messageId, allowArchive, expectedPath, onSaved }, signal);
}
async function storeImageReferences(c:Conversation,images:string[]){
  if(!images.length)return;
  await attachmentImages(db,{attachments:images.map(assetId=>({assetId}))});
  const drafts={...c.imageDrafts};delete drafts[c.activeTimelineId||''];
  await db.conversations.update(c.id,{imageDrafts:drafts});
}
export async function continueMessage(id:string,messageId:string,signal?:AbortSignal,expectedPath?:ExpectedPath,onSaved?:(path:ExpectedPath)=>Promise<void>){
 return generate(id,{messageId,continuation:true,expectedPath,onSaved},signal);
}
interface GenerateOptions {
  continuation?:boolean;
  replyTo?: MessageQuote;
  images?: string[];
  expectedPath?: ExpectedPath;
  text?: string;
  retry?: boolean;
  onSaved?: (path:ExpectedPath) => Promise<void>;
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
  let target:Message|undefined;
  let interruption:import("./chatCompletion").ReplyInterruption|undefined;
  let reply = "";
  let acquired = false;
  let release = () => {};
  try {
    const c = await db.transaction(
      "rw",
      [...timelineTables(),db.assets],
      async () => {
        const c = await db.conversations.get(id);
        if (!c) throw Error("会话已删除。");
        if(options.expectedPath&&(c.activeTimelineId!==options.expectedPath.timelineId||(c.timelineEpoch??0)!==options.expectedPath.epoch))throw Error("剧情已在其他窗口切换，请确认当前消息后重试。");
        if (c.sendingUntil && c.sendingUntil > Date.now())
          throw Error("此会话正在回复中，请稍候。");
        if(!options.retry&&!options.messageId)await storeImageReferences(c,options.images||[]);
        await ensureTimelineInTransaction(id);
        const rows = await activeMessages(id,undefined,true);
        const last = rows.at(-1);
        if(!options.retry&&!options.messageId&&options.replyTo)await assertQuoteForSend(options.replyTo,(await db.conversations.get(id))!,rows);
        if (options.messageId) {
          const index = rows.findIndex(
            (m) => m.id === options.messageId && m.role === "assistant",
          );
          if (index < 0) throw Error("目标 AI 回复不在当前有效路径。");
          if(options.continuation){
            target=rows[index];
            if(c.mode!=='daily'||index!==rows.length-1||!validInterruption(target.replyInterruption)||target.bubbleDeletion||target.userEdited)throw Error('仅可续接当前日常聊天末尾未编辑、未删除的中断回复。');
          }
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
              ...(options.replyTo?{replyTo:options.replyTo}:{}),
              ...(options.images?.length?{attachments:options.images.map(assetId=>({assetId}))}:{}),
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
    await options.onSaved?.({timelineId:c.activeTimelineId,epoch:c.timelineEpoch??0});
    const { config, key } = await resolveApi(c);
    const context = await buildContext(c, options.messageId);
    if (
      controller.signal.aborted ||
      (await db.conversations.get(id))?.sendingToken !== token
    )
      throw Error("请求已取消，原消息和版本已保留。");
    if(options.continuation&&target){
      if(context.reduce((n,m)=>n+m.content.length,0)+target.content.length+300>contextLimits.historyChars+contextLimits.systemChars)throw Error('续接上下文超出安全预算，原回复已保留；未发出额外请求。');
      context[0]={...context[0],content:context[0].content+'\n本次是用户主动要求续接已中断的同一条回复。仅返回接在原文末尾的新内容，不重述前文，不另起一个无关回复；原文未闭合的句子从断点继续。'};
      context.push({role:'assistant',content:target.content},{role:'user',content:'[续接操作：请从上条角色回复的断点继续，仅输出后续文字。此操作不是新的剧情行动。]'});
      if(context[0].content.length>contextLimits.systemChars)throw Error('续接系统上下文超出安全预算，原回复已保留；未发出额外请求。');
    }
    // One request, not a second heart-voice API call. Continuation stays plain text.
    if(!options.continuation){
      const heartInstruction='\n\n心声与回复联合生成协议：请根据当前角色的人格、说话方式、世界专属设定及规则、已发生剧情、双方关系、角色已知信息和用户刚刚的行动，构建本轮角色一致的情绪、动机、取舍与行动。由同一人物状态共同决定角色说出口的台词/动作，以及没有说出口的心理活动；心声须解释、补充或有意反衬当轮言行，而不是在回复完成后凭空补一段情绪。先输出自然完整的角色回复，再于末尾输出 [心声]该角色此刻未说出口的内心独白[/心声]。不得泄露角色未知信息、跨空间经历，不得擅自改写既有事实、秘密或关系；不要套用甜宠模板，不要强加爱意、嫉妒或占有欲，冷漠、算计、犹豫或无所谓也可以是真实心声。心声是原创角色叙事，不是模型的内部推理过程；不输出数值指标。心声不超过150字，正文不出现心声标签。';
      if(context[0]?.role==='system'&&context[0].content.length+heartInstruction.length<=contextLimits.systemChars)context[0]={...context[0],content:context[0].content+heartInstruction};
    }
    const result=c.mode==='daily'?await requestChatReply(config,key,context,controller.signal):{text:await requestReply(config,key,context,controller.signal),interruption:undefined};
    interruption=result.interruption;
    const parsed=options.continuation?{text:stripLeakedTimeMarkers(result.text),heartVoice:target?.heartVoice}:parseHeartVoice(result.text);
    parsed.text=stripLeakedTimeMarkers(parsed.text);
    reply=options.continuation&&target?appendContinuation(target.content,parsed.text):parsed.text;
    const heartVoice=parsed.heartVoice;
    if(!reply.trim())throw Error('AI 本次未返回有效角色回复，已忽略不完整心声；可重试生成。');
    const preserveTimeout=interruption==='timeout'&&!signal?.aborted;
    if (controller.signal.aborted&&!preserveTimeout)
      throw Error("请求已取消，原消息和版本已保留。");
    const committed=await db.transaction("rw", messageTables(), async () => {
      const current = await db.conversations.get(id);
      if (
        !current ||
        current.sendingToken !== token ||
        current.activeTimelineId !== c.activeTimelineId || current.timelineEpoch !== c.timelineEpoch ||
        (controller.signal.aborted&&!preserveTimeout)
      )
        return;
      const rows = await activeMessages(id,undefined,true);
      let savedMessageId:string;
      if (options.messageId) {
        savedMessageId=options.messageId;
        const index = rows.findIndex(
          (m) => m.id === options.messageId && m.role === "assistant",
        );
        if (index < 0) return;
        const m = rows[index];
        if(options.continuation&&(!target||m.content!==target.content||m.activeVariantId!==target.activeVariantId||m.bubbleDeletion||m.userEdited||index!==rows.length-1))throw Error('回复或分支已变化，续接未覆盖原文。');
        if (index < rows.length - 1) {
          if (!options.allowArchive)
            throw Error("后续剧情已变化，请重新确认。");
          await snapshotPath(id, "regenerate");
          for (const later of rows.slice(index + 1))
            await db.messages.update(later.id, { archived: true });
        }
        await ensureVariant(m);
        await addGeneratedVariant(m, reply,interruption,heartVoice);
      } else {
        const last = rows.at(-1);
        const m = {
          id: crypto.randomUUID(),
          conversationId: id,
          role: "assistant" as const,
          content: reply,
          createdAt: Math.max(Date.now(), (last?.createdAt || 0) + 1),
        };
        savedMessageId=m.id;
        await db.messages.add(m);
        await addGeneratedVariant(m, reply,interruption,heartVoice);
      }
      const nextPath=await commitTimelineProjection(id,options.messageId?"regenerate":"append");
      // Continuation changes only the assistant version. Carry an unsent image
      // draft onto that new projection without consuming it or changing its source.
      const draft=current.imageDrafts?.[current.activeTimelineId||''];
      if(options.continuation&&draft&&nextPath.id!==current.activeTimelineId)await db.conversations.update(id,{imageDrafts:{...current.imageDrafts,[nextPath.id]:draft}});
      await db.conversations.update(id, { updatedAt: Date.now() });
      const savedMessage=await db.messages.get(savedMessageId);
      return savedMessage?{conversation:current,message:savedMessage}:undefined;
    });
    if(committed&&!interruption)publishSavedChatMessage(committed.conversation,committed.message);
    if(!committed)throw Error("当前剧情已变化，回复未写入其他会话或分支。原消息和版本保留。");
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
  // A due reminder is acknowledged only when the successful reply actually mentions it.
  // Never consume a reminder after a failed or interrupted generation.
  if(!interruption&&!options.messageId)void (async()=>{
   const {getMemoryScope}=await import('./memoryStore');
   const {dueTimeMemories,acknowledgeTimeMemory,nextOccurrence}=await import('./smartTimeMemory');
   const scope=await getMemoryScope(id);
   for(const item of await dueTimeMemories(scope)){
    if((item.method==='role'||item.method==='both')&&reply.includes(item.title))await acknowledgeTimeMemory(scope,item.id,nextOccurrence(item));
   }
  })().catch(()=>{});
  // Detached from views and from normal reply completion. No auto retry on failure.
  if(!options.messageId&&!interruption){
    notifyAssistantReplyCommitted(id);
    // Direct fallback covers routes without a mounted foreground scheduler.
    // tryAutoSummary deduplicates concurrent calls by conversation.
    void import('./memorySummary').then(m=>m.tryAutoSummary(id)).catch(()=>{});
  }
  return {interruption};
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
    [db.worlds, db.worldProfiles, db.storySessions, db.storyNodes, db.themes, ...messageTables()],
    async () => {
      const conversations = await db.conversations
        .where("worldId")
        .equals(id)
        .toArray();
      for (const c of conversations) await purgeRecords(c.id);
      await db.conversations.where("worldId").equals(id).delete();
      await db.worldProfiles.where("worldId").equals(id).delete();
      await db.storyNodes.where('worldId').equals(id).delete();
      await db.storySessions.where('worldId').equals(id).delete();
      for(const theme of await db.themes.toArray())if(theme.userIdentities?.[`world:${id}`]){
        const identities={...theme.userIdentities};delete identities[`world:${id}`];
        await db.themes.update(theme.id,{userIdentities:identities});
      }
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

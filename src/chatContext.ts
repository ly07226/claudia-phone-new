import { realTimeContext, realTimeSession, sessionHistory, sessionMarkerChars } from "./realTimeContext";
import { recordLoreTrace } from "./loreDiagnostics";
import { activeMessages } from "./messagePath";
import { loreForConversation, injectLore } from "./loreEngine";
import { db } from "./store";
import type { ContextMessage, Conversation, Message } from "./chatTypes";
export const contextLimits = {
  historyMessages: 30,
  historyChars: 24000,
  systemChars: 24000,
  userChars: 8000,
};
/** Extension boundary for future explicit memories/summaries; no other conversation is queried. */
export async function buildContext(
  conversation: Conversation,
  beforeMessageId?: string,
): Promise<ContextMessage[]> {
  const c = await db.characters.get(conversation.characterId);
  if (!c) throw Error("角色已不存在。");
  if (conversation.mode === "daily" && conversation.worldId)
    throw Error("日常会话关联异常。");
  let system = `你正在进行角色扮演。遵循角色资料回应用户。只使用本会话提供的资料，不声称知道其他聊天空间的经历。\n角色：${c.name}\n基础人格与设定：${c.persona}\n说话方式：${c.speakingStyle || "按基础人格自然回应"}`;
  if (conversation.mode === "world") {
    if (!conversation.worldId) throw Error("世界会话缺少世界。");
    const w = await db.worlds.get(conversation.worldId);
    if (!w) throw Error("世界已不存在。");
    const p = await db.worldProfiles
      .where("[worldId+characterId]")
      .equals([w.id, c.id])
      .first();
    if (!p) throw Error("角色已解除该世界关联。");
    system += `\n当前聊天空间：世界聊天\n世界：${w.name}\n简介：${w.description}\n规则：${w.rules || ""}\n背景：${w.background || ""}\n本世界角色设定：${p.setting}`;
  } else system += "\n当前聊天空间：日常聊天。此空间不采用任何世界背景。";
  // Reject excessive profile input rather than silently omitting critical world rules.
  if (system.length > contextLimits.systemChars)
    throw Error("角色与世界设定合计过长，请缩短到约 24000 字符以内。");
  const path = await activeMessages(conversation.id, beforeMessageId);
  const now=Date.now();
  const session=conversation.chatSettings?.followRealTime?realTimeSession(conversation.id,path,now,conversation.mode):null;
  const time = conversation.chatSettings?.followRealTime ? realTimeContext(conversation.id, path, now, undefined, conversation.mode) : null;
  const historyBudget=contextLimits.historyChars-(session?.newSession?sessionMarkerChars:0);
  if(time && system.length + time.content.length > contextLimits.systemChars)
    throw Error("角色、世界与真实时间上下文合计过长，请缩短角色或世界设定。");
  let lastReply = -1;
  for(let i=path.length-1;i>=0;i--)if(path[i].role==="assistant"){lastReply=i;break;}
  const pending = conversation.chatSettings?.continuousSend && !beforeMessageId
    ? path.slice(lastReply+1).filter(m=>m.role==="user") : [];
  // Save any number of messages, but never silently omit unanswered input at generation.
  if(pending.reduce((n,m)=>n+m.content.length,0)>historyBudget)
    throw Error("待回复消息超过 24000 字符安全上限，本次未请求 AI；消息仍已保存，请编辑或减少待回复内容后重试。");
  const rows = path.slice(-Math.max(contextLimits.historyMessages,pending.length)).reverse();
  const history: Message[] = [];
  let chars = 0;
  for (const m of rows) {
    if (m.conversationId !== conversation.id) throw Error("会话消息关联异常。");
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (chars + m.content.length > historyBudget) break;
    chars += m.content.length;
    history.unshift(m);
  }
  while (history[0]?.role === "assistant") history.shift();
  const lore = await loreForConversation(
    conversation,
    history,
    Math.max(0, contextLimits.systemChars - system.length - (time?.content.length ?? 0) - 4),
  );
  recordLoreTrace(conversation, lore.diagnostics, lore.skippedBooks);
  const context = injectLore(
    system,
    session?.newSession ? sessionHistory(history,session) : history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    lore.entries,
  );
  // Gemini accepts only the first systemInstruction. Keep the independently built
  // time block there without changing profile data or downgrading the profile role.
  return time ? [{...context[0], content: `${context[0].content}\n\n${time.content}`}, ...context.slice(1)] : context;
}

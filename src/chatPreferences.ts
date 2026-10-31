import { db, type Character } from "./store";
import { activeMessages } from "./messagePath";
import type { ChatSettings, Message } from "./chatTypes";
export const chatColors = ["#f3f5ec", "#e4eddf", "#f5efdf", "#e6eef0", "#efe8ee"];
export type ChatSettingsPatch = Omit<Partial<ChatSettings>, "background"> & {background?: ChatSettings["background"] | null};
export async function saveChatSettings(id: string, patch: ChatSettingsPatch) {
  return db.transaction("rw", [db.conversations, db.assets], async () => {
    const c = await db.conversations.get(id);
    if (!c) throw Error("会话已不存在，未保存设置。");
    if (patch.remark !== undefined && patch.remark.length > 80) throw Error("备注最多80个字符。");
    const background = patch.background;
    if (background?.kind === "color" && !/^#[0-9a-f]{6}$/i.test(background.color)) throw Error("请选择有效的背景颜色。");
    if (background?.kind === "image" && !(await db.assets.get(background.assetId))) throw Error("背景图片不存在，请重新选择。");
    const settings: ChatSettings = {...c.chatSettings, ...patch, background: background === null ? undefined : background ?? c.chatSettings?.background};
    if (patch.remark !== undefined) settings.remark = patch.remark.trim();
    if (patch.pinned !== undefined) settings.pinnedAt = patch.pinned ? c.chatSettings?.pinnedAt ?? Date.now() : undefined;
    await db.conversations.update(id, {chatSettings: settings});
    return {...c, chatSettings: settings};
  });
}
export function orderChatCharacters<T extends Pick<Character,"id">>(characters: T[], preferences: Record<string,{pinned?:boolean;pinnedAt?:number}>) {
  return characters.map((character,index)=>({character,index})).sort((a,b)=>{
    const ap=preferences[a.character.id],bp=preferences[b.character.id];
    if (!!ap?.pinned !== !!bp?.pinned) return ap?.pinned ? -1 : 1;
    if (ap?.pinned && bp?.pinned) return (ap.pinnedAt||0)-(bp.pinnedAt||0) || a.character.id.localeCompare(b.character.id);
    return a.index-b.index;
  }).map(row=>row.character);
}
/** Only the active branch and valid selected variants; no writes and no context mutation. */
export async function searchableMessages(id: string): Promise<Message[]> {
  const rows=(await activeMessages(id)).filter(m=>m.role==='user'||m.role==='assistant');
  const variants = new Map((await db.messageVariants.bulkGet(rows.flatMap(m=>m.role==='assistant'&&m.activeVariantId?[m.activeVariantId]:[]))).filter(v=>!!v).map(v=>[v!.id,v!]));
  return rows.filter(m=>{if(m.role!=='assistant'||!m.activeVariantId)return true;const v=variants.get(m.activeVariantId);return v?.messageId===m.id&&v.conversationId===id;});
}
export async function searchConversation(id:string, query:string) {
  const needle=query.trim().toLocaleLowerCase();if(!needle)return [];
  const rows=await searchableMessages(id);
  return rows.flatMap((m,index)=>{
    const at=m.content.toLocaleLowerCase().indexOf(needle);if(at<0)return [];
    const start=Math.max(0,at-35),end=Math.min(m.content.length,at+needle.length+85);
    return [{id:m.id,role:m.role,createdAt:m.createdAt,snippet:(start?'…':'')+m.content.slice(start,end)+(end<m.content.length?'…':''),before:rows[index-1]?.content.slice(0,60),after:rows[index+1]?.content.slice(0,60)}];
  });
}

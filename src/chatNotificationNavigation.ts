import type {SavedChatMessage} from './chatMessageEvents';
import {db,usePhone} from './store';
import {useSpaces} from './spaces';
import {openPhoneApp} from './phonePageNavigation';
export const openChatEvent='claudia:open-chat';
let pending:SavedChatMessage|undefined;
let visible:string|undefined;
let opening=0;
export function markVisibleChat(id:string){visible=id;window.dispatchEvent(new Event('claudia:chat-visible'));return()=>{if(visible===id)visible=undefined;};}
export function isTargetChatVisible(event:SavedChatMessage){const s=usePhone.getState(),n=useSpaces.getState();return document.visibilityState==='visible'&&visible===event.conversationId&&['聊天','世界聊天'].includes(s.activeApp??'')&&n.space?.spaceId===(event.worldId?'world:'+event.worldId:'daily');}
export function takeChatOpen(worldId?:string){if(!pending||pending.worldId!==worldId)return;const value=pending;pending=undefined;return value;}
export async function openSavedChat(event:SavedChatMessage){
 const ticket=++opening;const c=await db.conversations.get(event.conversationId);
 if(!c||c.characterId!==event.characterId||c.worldId!==event.worldId||!await db.characters.get(c.characterId))return false;
 if(c.worldId&&!await db.worldProfiles.where('[worldId+characterId]').equals([c.worldId,c.characterId]).first())return false;
 if(ticket!==opening)return false;pending=event;
 const desired=event.worldId?`world:${event.worldId}` as const:'daily';
 if(useSpaces.getState().space?.spaceId!==desired)await useSpaces.getState().enterSpace(desired);
 if(ticket!==opening)return false;
 if(useSpaces.getState().space?.spaceId!==desired){pending=undefined;return false;}
 openPhoneApp(event.worldId?'世界聊天':'聊天');window.dispatchEvent(new Event(openChatEvent));return true;
}

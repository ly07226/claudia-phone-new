import type {Conversation,Message} from './chatTypes';
import {visibleMessage} from './messageBubbles';
/** Shared commit boundary. Producers publish only AFTER their write transaction resolves. */
export interface SavedChatMessage {conversationId:string;characterId:string;worldId?:string;messageId:string;createdAt:number;preview:string}
const listeners=new Set<(event:SavedChatMessage)=>void>();
export function subscribeChatMessages(listener:(event:SavedChatMessage)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function publishSavedChatMessage(c:Conversation,m:Message){
 if(m.role!=='assistant'||m.conversationId!==c.id||m.replyInterruption||m.archived)return;
 const event:SavedChatMessage={conversationId:c.id,characterId:c.characterId,worldId:c.mode==='world'?c.worldId:undefined,messageId:m.id,createdAt:m.createdAt,preview:visibleMessage(m).content.replace(/\s+/g,' ').trim().slice(0,180)};
 for(const listener of listeners){try{listener(event);}catch{/* Display cannot invalidate a committed reply. */}}
}

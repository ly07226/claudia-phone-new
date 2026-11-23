import {db} from './store';
import {reconcileApiDefault,usableApi} from './apiSelection';
import {requestReply} from './chatProvider';
import {buildGroupTurnPrompt,parseGroupReplies,type GroupRoom,type GroupMessage} from './groupChatCore';
import {appendGroupMessages,listGroupMessages} from './groupChatStore';
const running=new Set<string>();
export async function sendGroupTurn(room:GroupRoom,text:string):Promise<GroupMessage[]>{
 return generateGroupTurn(room,text,false);
}
/** Retry a failed reply without adding the player's message a second time. */
export async function retryGroupTurn(room:GroupRoom):Promise<GroupMessage[]>{
 return generateGroupTurn(room,'',true);
}
async function generateGroupTurn(room:GroupRoom,text:string,retry:boolean):Promise<GroupMessage[]>{
 const message=text.trim();
 if(!retry&&(!message||message.length>8000))throw Error('请输入 1–8000 字符');
 if(running.has(room.id))throw Error('群聊正在回复，请稍候');
 running.add(room.id);
 try{
  const characters=await Promise.all(room.memberIds.map(id=>db.characters.get(id)));
  if(characters.some(c=>!c))throw Error('群聊中有角色已删除');
  const speakers=characters.map(c=>({id:c!.id,name:c!.name,persona:c!.persona,speakingStyle:c!.speakingStyle}));
  if(!retry){
   const player:GroupMessage={id:crypto.randomUUID(),groupId:room.id,authorId:'player',text:message,createdAt:Date.now()};
   await appendGroupMessages(room.id,[player]);
  }
  const history=await listGroupMessages(room.id);
  if(retry&&history.at(-1)?.authorId!=='player')throw Error('没有待回复的玩家消息');
  // One shared enabled provider per group turn; never expose private conversation history.
  const selected=(await reconcileApiDefault()).config;
  if(!selected?.enabled)throw Error('请先启用默认 API');
  const credential=await db.apiCredentials.get(selected.id);
  if(!credential?.apiKey||!usableApi(selected,credential.apiKey))throw Error('默认 API 不可用，请检查设置');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),90000);
  try{
   const prompt=buildGroupTurnPrompt(room,speakers,history);
   const raw=await requestReply(selected,credential.apiKey,[{role:'system',content:'你负责一个独立的多人群聊。只按给定的成员身份输出 JSON 回复，禁止角色争吵或透露私聊内容。'},{role:'user',content:prompt}],controller.signal);
   const replies=parseGroupReplies(raw,room).map((r,i):GroupMessage=>({id:crypto.randomUUID(),groupId:room.id,authorId:r.characterId,text:r.text,createdAt:Date.now()+i}));
   await appendGroupMessages(room.id,replies);
   return replies;
  }finally{clearTimeout(timer)}
 }finally{running.delete(room.id)}
}

/** Independent group conversations. No private-chat transcript is implicitly shared. */
export type GroupSpeaker = {id:string; name:string; persona:string; speakingStyle?:string};
export type GroupMessage = {id:string; groupId:string; authorId:string|'player'; text:string; createdAt:number; imageIds?:string[]};
export type GroupRoom = {id:string; title:string; memberIds:string[]; createdAt:number; updatedAt:number};
export type GroupMemoryFact = {groupId:string; sourceMessageIds:string[]; text:string; participantIds:string[]; createdAt:number};

/** Different opinions are allowed; abuse, hostility, jealousy and manufactured rivalry are not. */
export const GROUP_CONDUCT_RULES = [
 '角色可以自然接话、开玩笑、温和表达不同意见，但不得吵架、辱骂、敌对、挑拨、争宠或争风吃醋。',
 '尊重每个角色原有的人设与关系，不擅自补造角色之间的共同经历。',
 '不得替玩家说话、行动、承诺或决定情绪。',
 '只把群聊中确实发生的事情当作共同事实；私聊内容和个人秘密不能自动分享给其他群成员。',
 '不必每位成员都回复；不机械轮流；禁止无休止地角色互聊。'
] as const;

export function validateGroupRoom(room:GroupRoom,knownCharacterIds:ReadonlySet<string>):GroupRoom {
 const ids=[...new Set(room.memberIds)];
 if(!room.id.trim()||!room.title.trim())throw Error('群聊名称或编号不能为空');
 if(ids.length<2)throw Error('群聊至少需要两位角色');
 if(ids.length>12)throw Error('群聊最多支持十二位角色');
 if(ids.some(id=>!knownCharacterIds.has(id)))throw Error('群聊包含不存在的角色');
 return {...room,memberIds:ids};
}
export function groupVisibleMessages(groupId:string,messages:readonly GroupMessage[]):GroupMessage[]{
 return messages.filter(m=>m.groupId===groupId).sort((a,b)=>a.createdAt-b.createdAt);
}
/** Memory is extracted from actual group messages and only shared with participants. */
export function groupMemoryForCharacter(characterId:string,memberIds:readonly string[],facts:readonly GroupMemoryFact[]):GroupMemoryFact[]{
 if(!memberIds.includes(characterId))return [];
 return facts.filter(f=>f.participantIds.includes(characterId)&&f.sourceMessageIds.length>0);
}
export function buildGroupTurnPrompt(room:GroupRoom,speakers:readonly GroupSpeaker[],history:readonly GroupMessage[]):string {
 const allowed=new Set(room.memberIds);
 const members=speakers.filter(s=>allowed.has(s.id));
 if(members.length!==room.memberIds.length)throw Error('群聊角色资料不完整');
 const recent=groupVisibleMessages(room.id,history).slice(-35).map(m=>({
  author:m.authorId==='player'?'玩家':members.find(s=>s.id===m.authorId)?.name??'未知成员',
  text:m.text.slice(0,1000),
  imageCount:m.imageIds?.length??0
 }));
 return JSON.stringify({
  task:'为独立群聊生成下一轮自然互动，不读取或泄露任何成员私聊内容。',
  group:room.title,
  members:members.map(s=>({id:s.id,name:s.name,persona:s.persona.slice(0,2400),speakingStyle:(s.speakingStyle??'').slice(0,800)})),
  rules:GROUP_CONDUCT_RULES,
  recentMessages:recent,
  output:'严格输出 JSON 对象 {"replies":[{"characterId":"成员id","text":"回复"}]}。回复 1 至 4 条，仅使用本群成员 ID，不得输出玩家消息。'
 });
}
export function parseGroupReplies(raw:string,room:GroupRoom):{characterId:string;text:string}[]{
 const cleaned=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 const value:unknown=JSON.parse(cleaned);
 if(!value||typeof value!=='object'||!('replies' in value)||!Array.isArray(value.replies))throw Error('群聊回复格式无效');
 const allowed=new Set(room.memberIds);
 if(value.replies.length<1||value.replies.length>4)throw Error('群聊回复数量无效');
 return value.replies.map((r:unknown)=>{
  if(!r||typeof r!=='object'||!('characterId' in r)||!('text' in r)||typeof r.characterId!=='string'||!allowed.has(r.characterId)||typeof r.text!=='string'||!r.text.trim()||r.text.length>3000)throw Error('群聊回复包含无效角色或内容');
  return {characterId:r.characterId,text:r.text.trim()};
 });
}

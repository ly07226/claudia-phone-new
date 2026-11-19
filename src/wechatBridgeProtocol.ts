/** Pure, credential-free boundary for the future WeChat iLink bridge.
 * No network access, no browser storage and no automatic cloud enrollment.
 * Actual protocol decoding belongs to a separately audited server adapter.
 */
export type WechatBridgeStatus = 'unbound'|'pending'|'connected'|'expired'|'paused'|'error';
export interface DailyWechatBinding {
  id:string;
  ownerId:string;
  characterId:string;
  conversationId:string;
  mode:'daily';
  worldId?:never;
  status:WechatBridgeStatus;
}
export interface WechatTextEvent {
  provider:'wechat-ilink';
  externalMessageId:string;
  bindingId:string;
  direction:'inbound'|'outbound';
  text:string;
  receivedAt:number;
}
export interface BridgeConversation {
  id:string;
  characterId:string;
  mode:'daily'|'world';
  worldId?:string;
}
export function assertDailyWechatBinding(binding:DailyWechatBinding,conversation:BridgeConversation):void {
  if(!binding.id||!binding.ownerId||!binding.characterId||!binding.conversationId)
    throw Error('微信绑定缺少必要身份信息。');
  if(binding.mode!=='daily'||conversation.mode!=='daily'||conversation.worldId||('worldId' in binding))
    throw Error('微信仅支持日常聊天，不允许访问其他世界。');
  if(binding.conversationId!==conversation.id||binding.characterId!==conversation.characterId)
    throw Error('微信绑定与日常会话不匹配。');
  if(binding.status!=='connected')throw Error('微信尚未连接或已暂停。');
}
export function normalizeWechatTextEvent(value:unknown):WechatTextEvent {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('微信消息格式无效。');
  const event=value as Record<string,unknown>;
  if(event.provider!=='wechat-ilink'||event.direction!=='inbound'&&event.direction!=='outbound')
    throw Error('微信消息来源或方向无效。');
  for(const field of ['externalMessageId','bindingId'] as const)
    if(typeof event[field]!=='string'||!event[field]||event[field].length>256)
      throw Error('微信消息标识无效。');
  if(typeof event.text!=='string'||!event.text.trim()||event.text.length>8000)
    throw Error('微信消息正文无效。');
  if(typeof event.receivedAt!=='number'||!Number.isSafeInteger(event.receivedAt)||event.receivedAt<0)
    throw Error('微信消息时间无效。');
  return {provider:'wechat-ilink',externalMessageId:event.externalMessageId as string,
    bindingId:event.bindingId as string,direction:event.direction as 'inbound'|'outbound',
    text:event.text as string,receivedAt:event.receivedAt};
}
/** Idempotency key must be persisted with a unique constraint server-side.
 * This helper does NOT itself provide deduplication or delivery guarantees.
 */
export function wechatEventKey(event:WechatTextEvent):string {
  return JSON.stringify([event.provider,event.bindingId,event.direction,event.externalMessageId]);
}

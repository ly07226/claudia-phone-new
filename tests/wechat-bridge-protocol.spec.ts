import {test,expect} from '@playwright/test';
import {assertDailyWechatBinding,normalizeWechatTextEvent,wechatEventKey} from '../src/wechatBridgeProtocol';

const binding={id:'bind-1',ownerId:'owner-1',characterId:'char-1',conversationId:'daily-1',mode:'daily' as const,status:'connected' as const};
const conversation={id:'daily-1',characterId:'char-1',mode:'daily' as const};

test('only the matching daily conversation is eligible for WeChat',()=>{
  expect(()=>assertDailyWechatBinding(binding,conversation)).not.toThrow();
  expect(()=>assertDailyWechatBinding(binding,{...conversation,mode:'world',worldId:'world-1'})).toThrow();
  expect(()=>assertDailyWechatBinding(binding,{...conversation,characterId:'char-2'})).toThrow();
  expect(()=>assertDailyWechatBinding({...binding,status:'paused'},conversation)).toThrow();
});
test('text events are validated before any storage or model call',()=>{
  const event={provider:'wechat-ilink',bindingId:'bind-1',externalMessageId:'msg-1',direction:'inbound',text:'你好',receivedAt:123};
  expect(normalizeWechatTextEvent(event).text).toBe('你好');
  expect(()=>normalizeWechatTextEvent({...event,text:''})).toThrow();
  expect(()=>normalizeWechatTextEvent({...event,provider:'unknown'})).toThrow();
  expect(()=>normalizeWechatTextEvent({...event,receivedAt:NaN})).toThrow();
  expect(()=>normalizeWechatTextEvent({...event,text:'x'.repeat(8001)})).toThrow();
});
test('idempotency identity separates directions and bindings',()=>{
  const event=normalizeWechatTextEvent({provider:'wechat-ilink',bindingId:'b1',externalMessageId:'m1',direction:'inbound',text:'hi',receivedAt:1});
  expect(wechatEventKey(event)).toBe(wechatEventKey({...event,text:'hi again'}));
  expect(wechatEventKey(event)).not.toBe(wechatEventKey({...event,bindingId:'b2'}));
  expect(wechatEventKey(event)).not.toBe(wechatEventKey({...event,direction:'outbound'}));
});

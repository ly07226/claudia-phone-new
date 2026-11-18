import {test,expect} from '@playwright/test';
import {mergeWechatDailyPage} from '../src/wechatDailyMerge';
import type {WechatSyncPage} from '../src/wechatSyncClient';

const page:WechatSyncPage={
 ok:true,mode:'incremental',cursorType:'commit_ordered',
 binding:{id:'b1',conversationId:'daily-1',characterId:'char-1',status:'connected'},
 messages:[],nextSeq:0,hasMore:false
};
const expected={conversationId:'daily-1',characterId:'char-1',epoch:0};

test('rejects cross-conversation WeChat data before any local writes',async()=>{
 await expect(mergeWechatDailyPage({...page,binding:{...page.binding,conversationId:'other'}},expected))
   .rejects.toThrow('绑定已变化');
});
test('rejects wrong character and disconnected binding before any local writes',async()=>{
 await expect(mergeWechatDailyPage({...page,binding:{...page.binding,characterId:'other'}},expected))
   .rejects.toThrow('绑定已变化');
 await expect(mergeWechatDailyPage({...page,binding:{...page.binding,status:'paused'}},expected))
   .rejects.toThrow('绑定已变化');
});
test('rejects duplicate remote message IDs before any local writes',async()=>{
 const message={id:'remote-1',sync_seq:1,external_message_id:'ext-1',direction:'inbound' as const,
 body:'hi',status:'received',local_message_id:null,received_at:'2026-11-16T00:00:00Z',in_reply_to:null};
 await expect(mergeWechatDailyPage({...page,messages:[message,message]},expected))
   .rejects.toThrow('同步消息无效');
});

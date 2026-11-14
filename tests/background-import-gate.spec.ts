import {test,expect} from '@playwright/test';
import {selectBackgroundImports} from '../src/backgroundImportGate';
import type {Conversation,Message} from '../src/chatTypes';
import type {BackgroundSyncSnapshot} from '../src/backgroundReplySync';
const jobId='11111111-1111-4111-8111-111111111111';
const c={id:'conversation-1',activeTimelineId:'timeline-1',timelineEpoch:3} as Conversation;
const user={id:'user-1',role:'user',conversationId:c.id,content:'hi',createdAt:1} as Message;
const job={id:jobId,conversation_id:c.id,client_message_id:user.id,timeline_id:c.activeTimelineId!,timeline_epoch:3,kind:'reply' as const,status:'completed' as const,error_code:null,updated_at:new Date().toISOString()};
const reply={job_id:jobId,message_id:'reply-1',conversation_id:c.id,body:'hello',created_at:new Date().toISOString()};
const snapshot=(patch:Partial<BackgroundSyncSnapshot>={}):BackgroundSyncSnapshot=>({ok:true,jobs:[job],replies:[reply],...patch});
test('accepts a completed reply only on the matching active timeline',()=>{
 expect(selectBackgroundImports(c,[user],snapshot())).toHaveLength(1);
 expect(selectBackgroundImports({...c,timelineEpoch:4},[user],snapshot())).toHaveLength(0);
 expect(selectBackgroundImports({...c,activeTimelineId:'timeline-2'},[user],snapshot())).toHaveLength(0);
});
test('does not duplicate replies or import another conversation',()=>{
 expect(selectBackgroundImports(c,[user,{...user,id:'reply-1',role:'assistant'}],snapshot())).toHaveLength(0);
 expect(selectBackgroundImports(c,[user],snapshot({replies:[{...reply,conversation_id:'other'}]}))).toHaveLength(0);
 expect(selectBackgroundImports(c,[user],snapshot({replies:[reply,reply]}))).toHaveLength(1);
});
test('does not attach an orphaned reply or an incomplete job',()=>{
 expect(selectBackgroundImports(c,[],snapshot())).toHaveLength(0);
 expect(selectBackgroundImports(c,[user],snapshot({jobs:[{...job,status:'failed'}]}))).toHaveLength(0);
 expect(selectBackgroundImports(c,[user],snapshot({replies:[{...reply,body:'  '}]}))).toHaveLength(0);
});

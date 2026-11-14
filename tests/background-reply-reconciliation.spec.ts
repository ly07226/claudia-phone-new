import {test,expect} from '@playwright/test';
test('cloud reply reconciliation rejects wrong timeline, old turn and duplicate IDs',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {eligibleBackgroundReplies}=await import('/src/backgroundReplyReconciliation.ts');
  const c={id:'conversation_1',activeTimelineId:'timeline_1',timelineEpoch:3};
  const active=[{id:'user_1',role:'user',conversationId:c.id,content:'hello',createdAt:1}];
  const job={id:'job_1',conversation_id:c.id,client_message_id:'user_1',timeline_id:'timeline_1',timeline_epoch:3,kind:'reply',status:'completed',error_code:null,updated_at:new Date().toISOString()};
  const reply={job_id:'job_1',message_id:'assistant_1',conversation_id:c.id,body:'hello back',created_at:new Date().toISOString()};
  const check=(jobs:any[],replies:any[],messages:any[]=active)=>eligibleBackgroundReplies(c as any,messages as any,{ok:true,jobs,replies});
  return {
   valid:check([job],[reply]).length,
   wrongTimeline:check([{...job,timeline_id:'timeline_2'}],[reply]).length,
   wrongEpoch:check([{...job,timeline_epoch:4}],[reply]).length,
   wrongOwnerConversation:check([{...job,conversation_id:'other'}],[reply]).length,
   staleUserTurn:check([{...job,client_message_id:'user_old'}],[reply]).length,
   alreadyReplied:check([job],[reply],[...active,{...reply,id:'assistant_1',role:'assistant'}]).length,
   duplicate:check([job],[reply,reply]).length,
   empty:check([job],[{...reply,body:''}]).length,
  };
 });
 expect(result).toEqual({valid:1,wrongTimeline:0,wrongEpoch:0,wrongOwnerConversation:0,staleUserTurn:0,alreadyReplied:0,duplicate:1,empty:0});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOutboundOwnership} from '../supabase/functions/_shared/outbound-ownership.mjs';
const outbound={id:'reply-1',user_id:'alice',binding_id:'binding-a',in_reply_to:'inbound-1'};
const source={id:'inbound-1',user_id:'alice',binding_id:'binding-a',direction:'inbound'};
const binding={id:'binding-a',user_id:'alice'};
const valid={outbound,source,binding,expectedBindingId:'binding-a'};
test('exact same owner, binding and source passes',()=>assert.equal(assertOutboundOwnership(valid),true));
for(const [name,patch] of [
 ['other user outbound',{outbound:{...outbound,user_id:'bob'}}],
 ['other user source',{source:{...source,user_id:'bob'}}],
 ['other user binding',{binding:{...binding,user_id:'bob'}}],
 ['other character binding',{source:{...source,binding_id:'binding-b'}}],
 ['wrong reply source',{outbound:{...outbound,in_reply_to:'inbound-2'}}],
 ['wrong binding id',{expectedBindingId:'binding-b'}],
 ['missing source',{source:null}],
 ['not inbound',{source:{...source,direction:'outbound'}}],
 ['missing user',{outbound:{...outbound,user_id:''}}]
])test('reject '+name,()=>assert.throws(()=>assertOutboundOwnership({...valid,...patch}),/cross_owner_route_denied/));

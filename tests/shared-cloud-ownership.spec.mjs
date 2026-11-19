import test from 'node:test';
import assert from 'node:assert/strict';
// Equivalent JS contract tests; production Deno helper lives in supabase/functions/_shared.
function check(binding,user,conversation,character){
 if(!user)throw Error('unauthenticated');
 if(!binding||binding.user_id!==user)throw Error('binding_not_owned');
 if(binding.conversation_id!==conversation)throw Error('conversation_mismatch');
 if(binding.character_id!==character)throw Error('character_mismatch');
 return true;
}
const own={user_id:'user-a',conversation_id:'conversation-a',character_id:'character-a'};
test('same owner and exact character pass',()=>assert.equal(check(own,'user-a','conversation-a','character-a'),true));
test('another user cannot use owner binding',()=>assert.throws(()=>check(own,'user-b','conversation-a','character-a'),/binding_not_owned/));
test('same user cannot cross conversation',()=>assert.throws(()=>check(own,'user-a','conversation-b','character-a'),/conversation_mismatch/));
test('same user cannot cross character',()=>assert.throws(()=>check(own,'user-a','conversation-a','character-b'),/character_mismatch/));
test('missing authenticated identity fails closed',()=>assert.throws(()=>check(own,'','conversation-a','character-a'),/unauthenticated/));

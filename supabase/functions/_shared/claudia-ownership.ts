// Shared-backend ownership checks for server-side handlers.
// Never authorize a character or conversation using a client-supplied ID alone.
export function assertOwnedBinding(binding, authenticatedUserId){
 if(!authenticatedUserId||typeof authenticatedUserId!=='string')throw Error('unauthenticated');
 if(!binding||binding.user_id!==authenticatedUserId)throw Error('binding_not_owned');
 return binding;
}
export function assertOwnedConversation(binding, authenticatedUserId, conversationId, characterId){
 assertOwnedBinding(binding,authenticatedUserId);
 if(typeof conversationId!=='string'||!conversationId||binding.conversation_id!==conversationId)throw Error('conversation_mismatch');
 if(typeof characterId!=='string'||!characterId||binding.character_id!==characterId)throw Error('character_mismatch');
 return binding;
}
export function assertOwnedMessage(message,binding,authenticatedUserId){
 assertOwnedBinding(binding,authenticatedUserId);
 if(!message||message.user_id!==authenticatedUserId||message.binding_id!==binding.id)throw Error('message_not_owned');
 return message;
}

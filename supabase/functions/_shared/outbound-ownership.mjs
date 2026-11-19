// Shared server-side guard for privileged outbound delivery. No browser-supplied owner IDs.
export function assertOutboundOwnership({outbound,source,binding,expectedBindingId}){
 if(!outbound||!source||!binding||!expectedBindingId||
    !outbound.user_id||typeof outbound.user_id!=='string'||
    outbound.binding_id!==expectedBindingId||binding.id!==expectedBindingId||
    source.binding_id!==expectedBindingId||
    outbound.user_id!==source.user_id||outbound.user_id!==binding.user_id||
    outbound.in_reply_to!==source.id||source.direction!=='inbound')
   throw Error('cross_owner_route_denied');
 return true;
}

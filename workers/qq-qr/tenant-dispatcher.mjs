// Server-only Supabase routing. No user-supplied URL is accepted at dispatch time.
// Callers must authenticate tenant ownership before looking up a registered tenant.
const ALLOWED_FUNCTIONS=new Set([
 'claudia-qq-bridge-confirm','claudia-qq-bridge-restore',
 'claudia-qq-ai-run','claudia-qq-outbound',
 'claudia-wechat-sync','claudia-wechat-login'
]);
export function createTenantDispatcher({registry,fetchImpl=fetch,timeoutMs=20000}){
 if(!registry||typeof registry.get!=='function')throw Error('registry_required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>145000)throw Error('invalid_timeout');
 return async function dispatch({tenantId,functionName,body={},accessToken}){
  if(!ALLOWED_FUNCTIONS.has(functionName))throw Error('function_not_allowed');
  const tenant=registry.get(tenantId);
  if(!tenant)throw Error('tenant_not_registered');
  if(typeof accessToken!=='string'||accessToken.length<32)throw Error('missing_server_credential');
  const response=await fetchImpl(tenant.projectUrl+'/functions/v1/'+functionName,{
   method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
   body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'error'
  });
  if(!response.ok)throw Error('tenant_function_http_'+response.status);
  return response.json();
 };
}

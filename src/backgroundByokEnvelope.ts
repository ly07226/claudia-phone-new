import {cloudConfigured} from './cloudIdentity';
import {prepareBackgroundProviderSnapshot} from './backgroundProviderSnapshot';
import {db} from './store';

/** Public RSA-OAEP key distributed with the deployment, never the private key. */
const publicJwk=(import.meta.env.VITE_CLAUDIA_BYOK_PUBLIC_JWK as string|undefined)?.trim()??'';
const keyId=(import.meta.env.VITE_CLAUDIA_BYOK_KEY_ID as string|undefined)?.trim()??'';
function b64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s);}
export function byokEncryptionConfigured(){return cloudConfigured()&&!!publicJwk&&!!keyId;}
export async function prepareEncryptedBackgroundJob(conversationId:string){
 if(!byokEncryptionConfigured())throw Error('后台 API 加密通道尚未配置。');
 const snapshot=await prepareBackgroundProviderSnapshot(conversationId);
 const credential=await db.apiCredentials.get(snapshot.configId);
 if(!credential?.apiKey)throw Error('当前角色绑定的 API Key 不存在。');
 const jwk:unknown=JSON.parse(publicJwk);
 if(!jwk||typeof jwk!=='object'||(jwk as JsonWebKey).kty!=='RSA'||(jwk as JsonWebKey).alg!=='RSA-OAEP-256'||(jwk as JsonWebKey).key_ops?.includes('encrypt')===false)throw Error('后台加密公钥配置无效。');
 const key=await crypto.subtle.importKey('jwk',jwk as JsonWebKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'RSA-OAEP'},key,new TextEncoder().encode(credential.apiKey)));
 const protocol=snapshot.provider==='gemini'||snapshot.protocol==='gemini'?'gemini':'openai-chat';
 return {
  conversationId:snapshot.conversationId,clientMessageId:snapshot.clientMessageId,
  timelineId:snapshot.timelineId,timelineEpoch:snapshot.timelineEpoch,
  idempotencyKey:'reply:'+snapshot.clientMessageId+':'+snapshot.timelineId+':'+snapshot.timelineEpoch,
  kind:'reply' as const,providerBinding:'byok-v1' as const,
  messages:snapshot.messages,provider:snapshot.provider,protocol,
  baseUrl:snapshot.baseUrl,model:snapshot.model,temperature:snapshot.temperature,
  maxTokens:snapshot.maxTokens,keyId,encryptedKey:b64(encrypted)
 };
}

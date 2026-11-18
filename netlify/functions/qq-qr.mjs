import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const BRIDGE='https://qq-qr-bridge-production.up.railway.app';
const RAILWAY_ORIGIN='https://claudia-phone-new.vercel.app';
const cookieName='claudia_qq_qr';
const reply=(statusCode,body,headers={})=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers},body:JSON.stringify(body)});
function mac(value,secret){return createHmac('sha256',secret).update(value).digest('hex');}
function verify(value,signature,secret){if(!value||!signature||!/^[a-f0-9]{64}$/.test(signature))return false;const a=Buffer.from(signature,'hex'),b=Buffer.from(mac(value,secret),'hex');return timingSafeEqual(a,b);}
export async function handler(event){
 const bridgeToken=process.env.QQ_QR_ACCESS_TOKEN;
 const sessionSecret=process.env.QQ_QR_SESSION_SECRET;
 if(!bridgeToken||bridgeToken.length<32||!sessionSecret||sessionSecret.length<32)return reply(503,{error:'QQ 安全代理尚未配置，请先在 Netlify 配置服务端环境变量。'});
 const method=event.httpMethod;
 const attemptId=event.queryStringParameters?.attemptId;
 const isStart=method==='POST'&&!attemptId;
 if(!isStart&&!(method==='GET'&&/^[0-9a-f-]{36}$/i.test(attemptId||'')))return reply(405,{error:'invalid_request'});
 const incomingOrigin=event.headers.origin;
 const host=event.headers.host;
 if(incomingOrigin&&new URL(incomingOrigin).host!==host)return reply(403,{error:'origin_mismatch'});
 const cookies=Object.fromEntries((event.headers.cookie||'').split(';').map(part=>{const i=part.indexOf('=');return i<0?['','']:[part.slice(0,i).trim(),part.slice(i+1).trim()];}));
 let session=null;
 const signed=cookies[cookieName];
 if(signed){const [value,sig]=signed.split('.');if(verify(value,sig,sessionSecret)){try{const data=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));if(data.expires>Date.now())session=data;}catch{}}}
 if(!isStart&&(!session||session.attemptId!==attemptId))return reply(403,{error:'此二维码不属于当前浏览器会话，请重新生成。'});
 if(isStart&&session)return reply(429,{error:'当前已有扫码会话，请等待过期后再试。'});
 try{
  const upstream=await fetch(BRIDGE+(isStart?'/qq/qr/start':'/qq/qr/'+encodeURIComponent(attemptId)),{
   method:isStart?'POST':'GET',
   headers:{Origin:RAILWAY_ORIGIN,Authorization:'Bearer '+bridgeToken,Accept:'application/json'},
   signal:AbortSignal.timeout(12000)
  });
  const body=await upstream.json();
  if(!upstream.ok)return reply(upstream.status,{error:typeof body.error==='string'?body.error:'QQ 服务暂不可用'});
  if(isStart){
   if(typeof body.attemptId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.attemptId))return reply(502,{error:'QQ 会话响应无效'});
   const expires=Math.min(Date.now()+600000,Date.parse(body.expiresAt)||Date.now()+600000);
   const value=Buffer.from(JSON.stringify({attemptId:body.attemptId,expires})).toString('base64url');
   return reply(200,body,{'Set-Cookie':cookieName+'='+value+'.'+mac(value,sessionSecret)+'; Path=/api/qq/qr; HttpOnly; Secure; SameSite=Strict; Max-Age=600'});
  }
  return reply(200,body);
 }catch{return reply(502,{error:'QQ 服务连接失败，请稍后重试。'});}
}

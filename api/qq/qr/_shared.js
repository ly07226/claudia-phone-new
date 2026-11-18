import {createHmac,timingSafeEqual} from 'node:crypto';
const BRIDGE='https://qq-qr-bridge-production.up.railway.app';
const COOKIE='claudia_qq_qr';
function reply(res,status,body){res.status(status).setHeader('Cache-Control','no-store').setHeader('X-Content-Type-Options','nosniff').json(body);}
const sign=(value,secret)=>createHmac('sha256',secret).update(value).digest('hex');
function getSession(req,secret){
 const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(part=>{const i=part.indexOf('=');return i<0?['','']:[part.slice(0,i).trim(),part.slice(i+1).trim()];}));
 const signed=cookies[COOKIE];if(!signed)return null;
 const [value,mac]=signed.split('.');if(!value||!mac||!/^[a-f0-9]{64}$/.test(mac))return null;
 if(!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(sign(value,secret),'hex')))return null;
 try{const data=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));return data.expires>Date.now()?data:null;}catch{return null;}
}
export async function handleQr(req,res,attemptId){
 const token=process.env.QQ_QR_ACCESS_TOKEN,secret=process.env.QQ_QR_SESSION_SECRET;
 if(!token||token.length<32||!secret||secret.length<32)return reply(res,503,{error:'QQ 安全代理尚未配置。'});
 const start=!attemptId&&req.method==='POST';
 if(!start&&!(req.method==='GET'&&/^[0-9a-f-]{36}$/i.test(attemptId||'')))return reply(res,405,{error:'invalid_request'});
 const origin=req.headers.origin;
 if(origin){try{if(new URL(origin).host!==req.headers.host)return reply(res,403,{error:'origin_mismatch'});}catch{return reply(res,403,{error:'invalid_origin'});}}
 const session=getSession(req,secret);
 if(!start&&(!session||session.attemptId!==attemptId))return reply(res,403,{error:'此二维码不属于当前浏览器会话，请重新生成。'});
 if(start&&session)return reply(res,429,{error:'当前已有扫码会话，请等待过期后再试。'});
 try{
  const response=await fetch(BRIDGE+(start?'/qq/qr/start':'/qq/qr/'+encodeURIComponent(attemptId)),{
   method:start?'POST':'GET',headers:{Origin:'https://claudia-phone-new.vercel.app',Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(12000)
  });
  const body=await response.json();
  if(!response.ok)return reply(res,response.status,{error:typeof body.error==='string'?body.error:'QQ 服务暂不可用'});
  if(start){
   if(typeof body.attemptId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.attemptId))return reply(res,502,{error:'QQ 会话响应无效'});
   const expires=Math.min(Date.now()+600000,Date.parse(body.expiresAt)||Date.now()+600000);
   const value=Buffer.from(JSON.stringify({attemptId:body.attemptId,expires})).toString('base64url');
   res.setHeader('Set-Cookie',COOKIE+'='+value+'.'+sign(value,secret)+'; Path=/api/qq/qr; HttpOnly; Secure; SameSite=Strict; Max-Age=600');
  }
  return reply(res,200,body);
 }catch{return reply(res,502,{error:'QQ 服务连接失败，请稍后重试。'});}
}

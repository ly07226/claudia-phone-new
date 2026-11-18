// QQ Bot QR bridge: a short-lived, server-side connector. No QQ credentials are returned to browsers.
// Run with Node >=20 and install @tencent-connect/qqbot-connector@1.2.0.
// Configure QQ_QR_ORIGIN (exact frontend origin) and QQ_QR_ACCESS_TOKEN (random 32+ byte secret).
import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { startQrConnect } from '@tencent-connect/qqbot-connector';

const origin=process.env.QQ_QR_ORIGIN;
const token=process.env.QQ_QR_ACCESS_TOKEN;
if(!origin||!/^https:\/\//.test(origin)||!token||token.length<32)throw Error('QQ_QR_ORIGIN and QQ_QR_ACCESS_TOKEN (32+ chars) required');
const sessions=new Map();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Vary':'Origin'});res.end(JSON.stringify(data));};
function authorized(req){const supplied=req.headers.authorization?.replace(/^Bearer /,'')||'';const a=Buffer.from(supplied),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b);}
function cleanup(){for(const [id,s] of sessions){if(Date.now()>s.until){s.stop?.();sessions.delete(id);}}}
setInterval(cleanup,30000).unref();
http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'});return res.end();}
 if(req.headers.origin!==origin||!authorized(req))return json(res,403,{error:'unauthorized'});
 const path=new URL(req.url||'/', 'http://localhost').pathname;
 if(req.method==='POST'&&path==='/qq/qr/start'){
  cleanup();if(sessions.size>=5)return json(res,429,{error:'too_many_sessions'});
  const id=randomUUID();const s={status:'waiting',url:null,until:Date.now()+10*60*1000,stop:null};sessions.set(id,s);
  try{
   s.stop=startQrConnect({
    onQrDisplayed(url){if(typeof url==='string'&&/^https:\/\//.test(url)){s.url=url;s.status='waiting';}},
    onQrExpired(){s.url=null;s.status='refreshing';},
    onSuccess(credentials){s.status='connected';s.url=null;s.credentials=credentials;/* TODO: encrypt and persist in owner-scoped database before production use */},
    onFailure(){s.status='failed';s.url=null;}
   },{displayQrCodeToConsole:false});
   return json(res,200,{attemptId:id,status:s.status,qrContent:s.url});
  }catch{sessions.delete(id);return json(res,502,{error:'qq_connector_failed'});}
 }
 const match=path.match(/^\/qq\/qr\/([0-9a-f-]{36})$/);
 if(req.method==='GET'&&match){const s=sessions.get(match[1]);return s?json(res,200,{status:s.status,qrContent:s.url,expiresAt:new Date(s.until).toISOString()}):json(res,404,{error:'expired'});}
 return json(res,404,{error:'not_found'});
}).listen(Number(process.env.PORT||3000),'0.0.0.0');

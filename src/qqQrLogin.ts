/** QQ QR requests are same-origin only. A server-side authenticated proxy must implement these routes.
 * Never put QQ_QR_ACCESS_TOKEN or robot credentials in browser code.
 */
export type QqQrSession={attemptId:string;qrContent:string|null;expiresAt:string;status:string};
async function request(path:string,method:'GET'|'POST'){
 const response=await fetch(path,{method,credentials:'same-origin',headers:{'Accept':'application/json'},cache:'no-store'});
 const type=response.headers.get('content-type')||'';
 if(!type.includes('application/json'))throw Error('QQ 安全扫码代理尚未接入当前站点，暂时不能生成二维码。');
 const body=await response.json() as Record<string,unknown>;
 if(!response.ok)throw Error(typeof body.error==='string'?body.error:'QQ 扫码服务暂不可用。');
 return body;
}
function parse(body:Record<string,unknown>):QqQrSession{
 if(typeof body.attemptId!=='string'||typeof body.status!=='string'||typeof body.expiresAt!=='string')throw Error('QQ 扫码服务返回数据不完整。');
 const qrContent=typeof body.qrContent==='string'?body.qrContent:null;
 return {attemptId:body.attemptId,status:body.status,expiresAt:body.expiresAt,qrContent};
}
export async function startQqQr():Promise<QqQrSession>{return parse(await request('/api/qq/qr/start','POST'));}
export async function pollQqQr(attemptId:string):Promise<QqQrSession>{
 if(!/^[0-9a-f-]{36}$/i.test(attemptId))throw Error('QQ 扫码会话无效。');
 const body=await request('/api/qq/qr/'+encodeURIComponent(attemptId),'GET');
 return parse({...body,attemptId});
}

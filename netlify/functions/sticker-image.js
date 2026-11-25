const allowedHosts=new Set(['i.postimg.cc','i.imgur.com']);
const allowedTypes=new Set(['image/png','image/jpeg','image/gif','image/webp']);
const maxSize=5*1024*1024;
export async function handler(event){
 if(event.httpMethod!=='GET')return {statusCode:405,body:''};
 let url;
 try{url=new URL(event.queryStringParameters?.url||'');}catch{return {statusCode:400,body:''};}
 if(url.protocol!=='https:'||!allowedHosts.has(url.hostname)||url.port||url.username||url.password||url.search||url.hash)return {statusCode:403,body:''};
 if(!/^\/[A-Za-z0-9_./-]+\.(png|jpe?g|gif|webp)$/i.test(url.pathname))return {statusCode:400,body:''};
 try{
  const upstream=await fetch(url.href,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'image/png,image/jpeg,image/gif,image/webp'}});
  const mime=(upstream.headers.get('content-type')||'').split(';')[0].trim();
  if(!upstream.ok||!upstream.body||!allowedTypes.has(mime))return {statusCode:422,body:''};
  if(Number(upstream.headers.get('content-length'))>maxSize)return {statusCode:413,body:''};
  const reader=upstream.body.getReader();const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxSize)return {statusCode:413,body:''};chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  return {statusCode:200,isBase64Encoded:true,headers:{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=3600'},body:Buffer.concat(chunks).toString('base64')};
 }catch{return {statusCode:502,body:''};}
}

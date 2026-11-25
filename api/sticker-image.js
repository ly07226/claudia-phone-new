const hosts=new Set(['i.postimg.cc','i.imgur.com']);
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).end();
 let url;try{url=new URL(String(req.query.url||''));}catch{return res.status(400).end();}
 if(url.protocol!=='https:'||!hosts.has(url.hostname)||url.port||url.username||url.password||url.search||url.hash)return res.status(403).end();
 if(!/^\/[A-Za-z0-9_./-]+\.(png|jpe?g|gif|webp)$/i.test(url.pathname))return res.status(400).end();
 const max=5*1024*1024;
 try{
 const upstream=await fetch(url.href,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'image/png,image/jpeg,image/gif,image/webp'}});
 const mime=(upstream.headers.get('content-type')||'').split(';')[0].trim();
 if(!upstream.ok||!upstream.body||!['image/png','image/jpeg','image/gif','image/webp'].includes(mime))return res.status(422).end();
 if(Number(upstream.headers.get('content-length'))>max)return res.status(413).end();
 const reader=upstream.body.getReader();const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)return res.status(413).end();chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 res.setHeader('Content-Type',mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public, max-age=3600');return res.status(200).send(Buffer.concat(chunks));
 }catch{return res.status(502).end();}
}

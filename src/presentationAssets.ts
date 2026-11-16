import {db,type Asset} from './store';
/** Keep uploaded presentation assets compatible, but do not load every historical
 * chat photo into every app. StoredImage reads those directly, only while mounted. */
export async function presentationAssets(records:unknown[],theme:any){
 const [assets,photoKeys]=await Promise.all([db.assets.where('type').notEqual('chat-image').toArray(),db.assets.where('type').equals('chat-image').primaryKeys()]);
 const photos=new Set(photoKeys),references=new Set<string>();
 const longestKey=photoKeys.reduce<number>((longest,key)=>Math.max(longest,typeof key==='string'?key.length:0),0);
 const visit=(value:unknown)=>{if(typeof value==='string'){if(value.length<=longestKey&&photos.has(value))references.add(value);}else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')Object.values(value).forEach(visit);};
 visit(records);visit(theme?{...theme,chatHub:theme.chatHub?{...theme.chatHub,posts:theme.chatHub.posts.map((p:any)=>[p.author,...p.comments.map((c:any)=>c.author)])}:undefined}:theme);
 // Old configurations can legally reference a chat-image as a conversation
 // backdrop. Read its ID, not all photo payloads or conversation message bodies.
 await db.conversations.each(c=>{if(c.chatSettings?.background?.kind==='image')visit(c.chatSettings.background.assetId);});
 const extra=await db.assets.bulkGet([...references]);return [...assets,...extra.filter((a):a is Asset=>!!a)];
}

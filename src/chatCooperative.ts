import Dexie from 'dexie';
/** Yield to input/render tasks, not merely to another microtask. Never scrolls or
 * changes styles. Keep an existing IDB transaction alive while yielding. */
export function chatYield():Promise<void>{
 const task=new Promise<void>(resolve=>{
  if(typeof MessageChannel==='undefined'){setTimeout(resolve,0);return;}
  const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);
 });
 return Dexie.currentTransaction?Dexie.waitFor(task):task;
}
export async function cloneChatRows<T>(rows:readonly T[]):Promise<T[]>{
 const result:T[]=[];let deadline=performance.now()+6;
 for(let i=0;i<rows.length;i+=128){result.push(...structuredClone(rows.slice(i,i+128)));if(performance.now()>=deadline){await chatYield();deadline=performance.now()+6;}}
 return result;
}
function freeze(value:unknown):void{
 if(!value||typeof value!=='object'||Object.isFrozen(value))return;
 for(const child of Object.values(value))freeze(child);Object.freeze(value);
}
const sizes=new WeakMap<object,number>();
/** Private immutable snapshots can be shared by trusted readers. Public callers
 * still receive detached mutable copies; no persisted data is frozen. */
export async function immutableChatRows<T extends {message:{content:string}}>(rows:T[],prefixLength=0,prefixChars=0){
 let chars=prefixChars,deadline=performance.now()+6;
 for(let i=prefixLength;i<rows.length;i++){freeze(rows[i]);chars+=rows[i].message.content.length;if(performance.now()>=deadline){await chatYield();deadline=performance.now()+6;}}
 Object.freeze(rows);sizes.set(rows,chars);return rows;
}
export const chatRowChars=(rows:readonly {message:{content:string}}[])=>sizes.get(rows)??rows.reduce((n,r)=>n+r.message.content.length,0);

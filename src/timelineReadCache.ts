import {chatRowChars} from './chatCooperative';
import Dexie,{RangeSet,rangesOverlap} from 'dexie';
import {db} from './store';
import type {ConversationPathNode} from './chatTypes';
interface Entry {nodes:ConversationPathNode[];positions:Map<string,number>;messages:Map<string,number>;keys:InstanceType<typeof RangeSet>;messageKeys:InstanceType<typeof RangeSet>;projection?:{timelineId:string;head?:string};valid:boolean}
const cache=new Map<string,Entry>();let installed=false,version=0;
const root=(tx:any):any=>tx?.parent?root(tx.parent):tx;
const additions=new WeakMap<object,Map<string,Set<string>>>();
export function appendedMessageIds(cid:string){return additions.get(root(Dexie.currentTransaction))?.get(cid);}
export function installTimelineReadCache(){
 if(installed)return;installed=true;
 const invalidate=(id:string)=>{const e=cache.get(id);if(e){e.valid=false;cache.delete(id);}version++;};
 db.pathNodes.hook('creating',()=>{version++;});
 db.messages.hook('creating',(_key,row,tx)=>{const owner=root(tx);let groups=additions.get(owner);if(!groups)additions.set(owner,groups=new Map());let ids=groups.get(row.conversationId);if(!ids)groups.set(row.conversationId,ids=new Set());ids.add(row.id);});
 for(const table of [db.messages,db.messageVariants]){
  const touch=(row:any,key:unknown)=>{version++;const e=cache.get(row.conversationId);if(e?.messages.has(table===db.messages?String(key):row.messageId))e.projection=undefined;};
  table.hook('updating',(_m,key,row)=>touch(row,key));table.hook('deleting',(key,row)=>touch(row,key));
 }

 db.pathNodes.hook('updating',(_mods,_key,row)=>invalidate(row.conversationId));
 db.pathNodes.hook('deleting',(_key,row)=>invalidate(row.conversationId));
 // Public Dexie range sets cover local AND cross-window writes, including bulk restore.
 // Appended random IDs do not intersect the already verified prefix.
 Dexie.on('storagemutated',parts=>{for(const key of [`idb://${db.name}/pathNodes/`,`idb://${db.name}/pathNodes/:dels`])if(parts[key])for(const [id,e] of cache)if(rangesOverlap(e.keys,parts[key]))invalidate(id);for(const key of [`idb://${db.name}/messages/`,`idb://${db.name}/messages/:dels`])if(parts[key])for(const e of cache.values())if(rangesOverlap(e.messageKeys,parts[key]))e.projection=undefined;});
 const clear=()=>{for(const e of cache.values())e.valid=false;cache.clear();version++;};let initial=true;db.on('ready',()=>{if(initial){initial=false;return;}clear();},true);db.on('close',clear);
}
export function cachedTimelinePrefix(id:string){installTimelineReadCache();const e=cache.get(id);if(e?.valid){cache.delete(id);cache.set(id,e);return e;}}
/** Cache only after the source transaction commits. Aborts never publish trust. */
export function cacheVerifiedTimeline(id:string,nodes:ConversationPathNode[],projection?:{timelineId:string;head?:string}){
 if(nodes.length>50000||chatRowChars(nodes)>8*1024*1024)return;
 const stamp=version,tx=root(Dexie.currentTransaction);
 const publish=()=>{if(stamp!==version)return;const previous=cache.get(id);if(previous?.valid&&nodes.length>=previous.nodes.length&&nodes[previous.nodes.length-1]?.id===previous.nodes.at(-1)?.id){const extra=nodes.slice(previous.nodes.length);for(const n of extra){const i=previous.positions.size;previous.positions.set(n.id,i);previous.messages.set(n.messageId,i);previous.keys.addKey(n.id);previous.messageKeys.addKey(n.messageId);}previous.nodes=nodes;if(projection)previous.projection=projection;return;}if(previous)previous.valid=false;const copy=nodes;const entry:Entry={nodes:copy,positions:new Map(copy.map((n,i)=>[n.id,i])),messages:new Map(copy.map((n,i)=>[n.messageId,i])),keys:new RangeSet().addKeys(copy.map(n=>n.id)),messageKeys:new RangeSet().addKeys(copy.map(n=>n.messageId)),projection,valid:true};cache.delete(id);cache.set(id,entry);while(cache.size>2){const key=cache.keys().next().value!;cache.get(key)!.valid=false;cache.delete(key);}};
 if(tx)tx.on('complete',publish);else publish();
}

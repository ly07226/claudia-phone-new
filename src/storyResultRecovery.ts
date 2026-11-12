import type {claimStory} from './storyStore';
import type {parseStoryReply} from './storyResponse';
type Claim=Awaited<ReturnType<typeof claimStory>>;
type Result=ReturnType<typeof parseStoryReply>;
const results=new Map<string,{key:string;result:Result;expires:number;owner:string}>();
const digest=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
/** No database migration or paid retry. Bind a validated response to its exact branch and settings. */
export async function storyResultKey(c:Claim){return JSON.stringify({session:c.session.id,revision:c.session.revision,head:c.session.headNodeId,action:c.action,length:c.length,path:await digest(JSON.stringify(c.path)),replacement:c.replacement?await digest(JSON.stringify(c.replacement)):undefined,definition:await digest(c.worldSnapshot),document:await digest(c.documentSnapshot),guidance:await digest(c.guidanceSnapshot)});}
export function hasStoryResult(worldId:string){const saved=results.get(worldId);if(saved&&saved.expires>Date.now())return true;results.delete(worldId);return false;}
export function recoverStoryResult(worldId:string,key:string,owner:string):Result|undefined{
 const saved=results.get(worldId);if(saved&&saved.key===key&&saved.expires>Date.now()){saved.owner=owner;return structuredClone(saved.result);}
 results.delete(worldId);
}
export function retainStoryResult(worldId:string,key:string,result:Result,owner:string){results.delete(worldId);results.set(worldId,{key,result:structuredClone(result),owner,expires:Date.now()+15*60000});if(results.size>4)results.delete(results.keys().next().value!);}
export function discardStoryResult(worldId:string,owner?:string){if(owner===undefined||results.get(worldId)?.owner===owner)results.delete(worldId);}

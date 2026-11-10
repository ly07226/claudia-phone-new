import type {SocialFailure} from './socialFailures';
export type HubTab='chats'|'contacts'|'moments'|'settings';
export interface SocialAuthor {kind:'user'|'character';id?:string;name:string;avatar?:string}
export interface SocialReaction {token:string;status:'queued'|'running'|'done'|'failed'|'skipped';characterId?:string;reason?:'no-role'|'limit'|'busy'}
export interface SocialComment {reaction?:SocialReaction;id:string;parentId?:string;author:SocialAuthor;text:string;createdAt:number}
export interface SocialPost {reaction?:SocialReaction;id:string;author:SocialAuthor;text:string;images:string[];createdAt:number;liked:boolean;comments:SocialComment[]}
export interface ChatHubData {
 version:1;tab:HubTab;cover?:string;posts:SocialPost[];
 draft:{text:string;images:string[]};auto:{enabled:boolean;hours:number;nextAt?:number;cursor:number};
 job?:{token:string;characterId:string;kind:'post'|'comment'|'reply';postId?:string;parentId?:string;expiresAt:number;reactionToken?:string};
 failures?:SocialFailure[];
 error?:string;
}
export const defaultChatHub=():ChatHubData=>({version:1,tab:'chats',posts:[],draft:{text:'',images:[]},auto:{enabled:false,hours:6,cursor:0}});
export function validateChatHub(x:unknown):asserts x is ChatHubData {
 if(x===undefined)return;const h=x as ChatHubData;
 const check=(v:unknown)=>{if(!v)throw Error('聊天模块数据格式无效，未修改原数据。');};
 const text=(s:unknown,n:number)=>typeof s==='string'&&s.length<=n;
 const id=(s:unknown)=>text(s,2000)&&!!s;
 const ids=(a:unknown,n:number)=>Array.isArray(a)&&a.length<=n&&a.every(id)&&new Set(a).size===a.length;
 const time=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
 const author=(a:SocialAuthor)=>check(a&&['user','character'].includes(a.kind)&&text(a.name,100)&&(a.kind!=='character'||id(a.id))&&(a.avatar===undefined||id(a.avatar)));
 check(h&&h.version===1&&['chats','contacts','moments','settings'].includes(h.tab)&&Array.isArray(h.posts)&&h.posts.length<=1000);
 check(h.draft&&text(h.draft.text,3000)&&ids(h.draft.images,3));check(h.cover===undefined||id(h.cover));
 check(h.auto&&typeof h.auto.enabled==='boolean'&&Number.isInteger(h.auto.hours)&&h.auto.hours>=2&&h.auto.hours<=24&&time(h.auto.cursor)&&(h.auto.nextAt===undefined||time(h.auto.nextAt)));
 const reaction=(r:SocialReaction|undefined,kind:string)=>{if(r===undefined)return;check(kind==='user'&&r&&id(r.token)&&['queued','running','done','failed','skipped'].includes(r.status)&&(r.status==='skipped'||id(r.characterId))&&(r.characterId===undefined||id(r.characterId))&&(r.reason===undefined||['no-role','limit','busy'].includes(r.reason)));};
 const postIds=new Set<string>();for(const p of h.posts){check(p&&id(p.id)&&!postIds.has(p.id));postIds.add(p.id);author(p.author);reaction(p.reaction,p.author.kind);check(text(p.text,3000)&&ids(p.images,3)&&(p.text.trim()||p.images.length)&&time(p.createdAt)&&typeof p.liked==='boolean'&&Array.isArray(p.comments)&&p.comments.length<=300);const seen=new Set<string>();for(const c of p.comments){check(c&&id(c.id)&&!seen.has(c.id)&&text(c.text,1000)&&!!c.text.trim()&&time(c.createdAt)&&(c.parentId===undefined||seen.has(c.parentId)));author(c.author);reaction(c.reaction,c.author.kind);seen.add(c.id);}}
 if(h.job?.reactionToken)check(id(h.job.reactionToken)&&h.job.kind!=='post'&&h.posts.some(p=>(h.job!.kind==='comment'?p.id===h.job!.postId&&p.reaction?.token===h.job!.reactionToken:p.id===h.job!.postId&&p.comments.some(c=>c.id===h.job!.parentId&&c.reaction?.token===h.job!.reactionToken))));
 if(h.job)check(id(h.job.token)&&id(h.job.characterId)&&['post','comment','reply'].includes(h.job.kind)&&time(h.job.expiresAt)&&(h.job.postId===undefined||postIds.has(h.job.postId))&&(h.job.parentId===undefined||h.posts.find(p=>p.id===h.job!.postId)?.comments.some(c=>c.id===h.job!.parentId)));
 if(h.failures!==undefined){check(Array.isArray(h.failures));const seen=new Set<string>();for(const f of h.failures){check(f&&id(f.id)&&!seen.has(f.id)&&['publish','comment-send','post','comment','reply'].includes(f.kind)&&time(f.createdAt)&&(f.postId===undefined||postIds.has(f.postId))&&(f.parentId===undefined||h.posts.find(p=>p.id===f.postId)?.comments.some(c=>c.id===f.parentId))&&(f.characterId===undefined||id(f.characterId)));seen.add(f.id);const d=f.details;check(d&&['quota','rate','network','auth','safety','server','unknown'].includes(d.kind)&&text(d.reason,200)&&text(d.suggestion,300)&&(d.httpStatus===undefined||Number.isInteger(d.httpStatus)&&d.httpStatus>=100&&d.httpStatus<=599)&&(d.serviceCode===undefined||text(d.serviceCode,100))&&(d.serviceMessage===undefined||text(d.serviceMessage,2000)));}}
 check(h.error===undefined||text(h.error,500));
}
export function hubAssetIds(h:ChatHubData){return [...new Set([h.cover,...h.draft.images,...h.posts.flatMap(p=>[p.author.avatar,...p.images,...p.comments.map(c=>c.author.avatar)])].filter((v):v is string=>!!v))];}
export async function remapChatHub(h:ChatHubData,asset:(id:string)=>Promise<string>,character:(id:string)=>Promise<string>){
 validateChatHub(h);const reaction=async(r:SocialReaction|undefined)=>r?{...r,...(r.characterId?{characterId:await character(r.characterId)}:{}),status:['queued','running'].includes(r.status)?'failed' as const:r.status}:undefined;const author=async(a:SocialAuthor)=>({...a,...(a.avatar?{avatar:await asset(a.avatar)}:{}),...(a.kind==='character'?{id:await character(a.id!)}:{})});
 return {...h,...(h.failures?{failures:await Promise.all(h.failures.map(async f=>({...f,...(f.characterId?{characterId:await character(f.characterId)}:{})})))}:{}),cover:h.cover?await asset(h.cover):undefined,draft:{...h.draft,images:await Promise.all(h.draft.images.map(asset))},auto:{...h.auto,enabled:false},job:undefined,posts:await Promise.all(h.posts.map(async p=>({...p,...(p.reaction?{reaction:await reaction(p.reaction)}:{}),author:await author(p.author),images:await Promise.all(p.images.map(asset)),comments:await Promise.all(p.comments.map(async c=>({...c,...(c.reaction?{reaction:await reaction(c.reaction)}:{}),author:await author(c.author)})))})))};
}

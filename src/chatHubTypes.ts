export type HubTab='chats'|'contacts'|'moments'|'settings';
export interface SocialAuthor {kind:'user'|'character';id?:string;name:string;avatar?:string}
export interface SocialComment {id:string;parentId?:string;author:SocialAuthor;text:string;createdAt:number}
export interface SocialPost {id:string;author:SocialAuthor;text:string;images:string[];createdAt:number;liked:boolean;comments:SocialComment[]}
export interface ChatHubData {
 version:1;tab:HubTab;cover?:string;posts:SocialPost[];
 draft:{text:string;images:string[]};auto:{enabled:boolean;hours:number;nextAt?:number;cursor:number};
 job?:{token:string;characterId:string;kind:'post'|'comment'|'reply';postId?:string;parentId?:string;expiresAt:number};
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
 const postIds=new Set<string>();for(const p of h.posts){check(p&&id(p.id)&&!postIds.has(p.id));postIds.add(p.id);author(p.author);check(text(p.text,3000)&&ids(p.images,3)&&(p.text.trim()||p.images.length)&&time(p.createdAt)&&typeof p.liked==='boolean'&&Array.isArray(p.comments)&&p.comments.length<=300);const seen=new Set<string>();for(const c of p.comments){check(c&&id(c.id)&&!seen.has(c.id)&&text(c.text,1000)&&!!c.text.trim()&&time(c.createdAt)&&(c.parentId===undefined||seen.has(c.parentId)));author(c.author);seen.add(c.id);}}
 if(h.job)check(id(h.job.token)&&id(h.job.characterId)&&['post','comment','reply'].includes(h.job.kind)&&time(h.job.expiresAt)&&(h.job.postId===undefined||postIds.has(h.job.postId))&&(h.job.parentId===undefined||h.posts.find(p=>p.id===h.job!.postId)?.comments.some(c=>c.id===h.job!.parentId)));
 check(h.error===undefined||text(h.error,500));
}
export function hubAssetIds(h:ChatHubData){return [...new Set([h.cover,...h.draft.images,...h.posts.flatMap(p=>[p.author.avatar,...p.images,...p.comments.map(c=>c.author.avatar)])].filter((v):v is string=>!!v))];}
export async function remapChatHub(h:ChatHubData,asset:(id:string)=>Promise<string>,character:(id:string)=>Promise<string>){
 validateChatHub(h);const author=async(a:SocialAuthor)=>({...a,...(a.avatar?{avatar:await asset(a.avatar)}:{}),...(a.kind==='character'?{id:await character(a.id!)}:{})});
 return {...h,cover:h.cover?await asset(h.cover):undefined,draft:{...h.draft,images:await Promise.all(h.draft.images.map(asset))},auto:{...h.auto,enabled:false},job:undefined,posts:await Promise.all(h.posts.map(async p=>({...p,author:await author(p.author),images:await Promise.all(p.images.map(asset)),comments:await Promise.all(p.comments.map(async c=>({...c,author:await author(c.author)})))})))};
}

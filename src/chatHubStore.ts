import {db,type Asset} from './store';
import {defaultChatHub,validateChatHub,type ChatHubData,type SocialAuthor} from './chatHubTypes';
export async function changeChatHub(change:(h:ChatHubData)=>void,assets:Asset[]=[]){
 return db.transaction('rw',[db.themes,db.assets],async()=>{const t=await db.themes.get('global');if(!t)throw Error('无法读取本机设置。');const h=structuredClone(t.chatHub??defaultChatHub());validateChatHub(h);change(h);validateChatHub(h);for(const a of assets)await db.assets.put(a);await db.themes.update(t.id,{chatHub:h});return h;});
}
export async function publishSocialPost(author:SocialAuthor){return changeChatHub(h=>{
 if(!h.draft.text.trim()&&!h.draft.images.length)throw Error('请输入文字或选择图片。');if(h.posts.length>=1000)throw Error('朋友圈已达本机容量上限，未删除旧动态。');
 h.posts.unshift({id:crypto.randomUUID(),author,text:h.draft.text,images:[...h.draft.images],createdAt:Date.now(),liked:false,comments:[]});h.draft={text:'',images:[]};
});}
export async function addSocialComment(postId:string,text:string,author:SocialAuthor,parentId?:string){let id='';await changeChatHub(h=>{const p=h.posts.find(p=>p.id===postId);if(!p)throw Error('原动态已不存在。');id=crypto.randomUUID();p.comments.push({id,parentId,text,author,createdAt:Date.now()});});return id;}

import {db,type World} from './store';
import type {StoryParticipants} from './storyTypes';
/** Only the new World's identity and linked static character definitions, never memories. */
export async function readStoryParticipants(world:World):Promise<StoryParticipants|undefined>{
 if(!world.script?.creation)return;
 const identity=(await db.themes.get('global'))?.userIdentities?.[`world:${world.id}`];
 if(!identity?.name?.trim())throw Error('当前世界缺少主控身份，请先在该世界的用户身份设置中补全。');
 const protagonist:StoryParticipants['protagonist']={name:identity.name,bio:identity.bio??'',customSetting:identity.customSetting??'',gender:'',appearance:'',personality:'',occupation:'',experience:''};
 for(const field of ['gender','appearance','personality','occupation','experience'] as const)if(typeof identity[field]==='string')protagonist[field]=identity[field] as string;
 if(typeof identity.age==='number'||typeof identity.age==='string')protagonist.age=identity.age;
 const profiles=(await db.worldProfiles.where('worldId').equals(world.id).toArray()).sort((a,b)=>(a.scriptOrder??999)-(b.scriptOrder??999)||a.id.localeCompare(b.id));
 if(!profiles.length)throw Error('当前世界没有关联角色，请先检查角色关联。');
 const characters:StoryParticipants['characters']=[];
 for(const profile of profiles){const c=await db.characters.get(profile.characterId);if(!c)throw Error('当前世界的角色关联已失效。');characters.push({name:c.name,persona:c.persona,speakingStyle:c.speakingStyle??'',setting:profile.setting});}
 const value={protagonist,characters};validateStoryParticipants(value);return value;
}
export function validateStoryParticipants(value:unknown):asserts value is StoryParticipants {
 const x=value as StoryParticipants;
 const check=(ok:unknown)=>{if(!ok)throw Error('主线主控或角色快照无效，未忽略资料。');};
 const text=(s:unknown,max=16000)=>typeof s==='string'&&s.length<=max;
 check(x&&typeof x==='object'&&Object.keys(x).every(k=>['protagonist','characters'].includes(k)));
 const p=x.protagonist;check(p&&typeof p==='object'&&Object.keys(p).every(k=>['name','bio','customSetting','gender','appearance','personality','occupation','experience','age'].includes(k)));
 check(text(p.name,80)&&p.name.trim());for(const key of ['bio','customSetting','gender','appearance','personality','occupation','experience'] as const)check(text(p[key]));if(p.age!==undefined)check(text(p.age,80)||typeof p.age==='number'&&Number.isFinite(p.age));
 check(Array.isArray(x.characters)&&x.characters.length>0&&x.characters.length<=30);
 for(const c of x.characters)check(c&&typeof c==='object'&&Object.keys(c).every(k=>['name','persona','speakingStyle','setting'].includes(k))&&text(c.name,80)&&c.name.trim()&&text(c.persona)&&text(c.speakingStyle)&&text(c.setting));
}

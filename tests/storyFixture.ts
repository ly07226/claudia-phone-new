import type {Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
export const reply=(n=1)=>({body:`第${n}个节点：你来到一座陌生城市，发现一封旧信。`,choices:[{id:'A',text:'查看信封'},{id:'B',text:'询问路人'},{id:'C',text:'暂时等待'},{id:'D',text:'前往广场'}]});
export async function storySeed(page:Page,provider='openai-compatible'){
 const name='story-fixture-'+crypto.randomUUID();await isolatedApp(page,name);
 await page.evaluate(async provider=>{const {db,usePhone}=await import('/src/store.ts');const {saveScriptWorld}=await import('/src/scriptWorlds.ts');for(const mode of ['story','everyday']){const w=await saveScriptWorld({name:mode,background:'城市背景',script:{version:1,playMode:mode as any,opening:'收到一封旧信',direction:'寻找真相，不锁定结局',definitionRevision:1}});await db.worlds.delete(w.id);await db.worlds.put({...w,id:mode});}await db.worlds.put({id:'legacy',name:'旧世界',description:'',createdAt:1});await db.apiConfigs.put({id:'story-api',name:'模拟',provider,baseUrl:'https://story.test/v1',model:'fixture',temperature:.7,maxTokens:5000,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'story-api',apiKey:'synthetic-story-fixture'});await usePhone.getState().reload();await(await import('/src/spaces.ts')).useSpaces.getState().enterSpace('world:story');},provider);return name;
}

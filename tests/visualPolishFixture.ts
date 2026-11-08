import {expect,type Page,type Route} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
import {app,space,theme} from './themeGlobalFixture';
export const storySegments=[{type:'narration',text:'雨后，林安带着一封旧信来到门口。\n'},{type:'action',text:'他微微挑眉，等待你的回应。\n'},{type:'dialogue',speaker:'林安',text:'“要先看看信上的日期吗？”\n'},{type:'narration',text:'窗外的脚步声渐渐远去。\n'.repeat(20)}];
export const nodeReply={body:storySegments.map(s=>s.text).join(''),segments:storySegments,choices:['观察信封','询问来人','暂时等候','查看窗外'].map((text,i)=>({id:'ABCD'[i],text}))};
const envelope=(value:unknown)=>({choices:[{finish_reason:'stop',message:{content:typeof value==='string'?value:JSON.stringify(value)}}]});
export async function polishPage(page:Page,mode:'daily'|'world'|'story',preset='white',long=false){
 await isolatedApp(page,'visual-polish-'+crypto.randomUUID());let seeding=mode==='story',calls=0,held:Route|undefined;
 await page.route('https://polish.test/**',r=>{calls++;if(seeding){const node={...nodeReply,choices:nodeReply.choices.map(c=>({...c,text:c.text+(long?'，先观察周围再作决定。'.repeat(12):'，确认细节后再行动。')}))};return r.fulfill({json:envelope(node)});}held=r;});
 await page.evaluate(async story=>{await(await import('/tests/backupAppFixture.ts')).richBackupData();const {db,usePhone}=await import('/src/store.ts');await db.apiConfigs.update('rich-api',{provider:'openai-compatible',baseUrl:'https://polish.test/v1',maxTokens:5000});if(story){await db.worlds.update('rich-world',{script:{version:1,playMode:'story',opening:'雨后收到一封信',definitionRevision:1}});await(await import('/src/storyGeneration.ts')).generateStory('rich-world');}await usePhone.getState().reload();},mode==='story');seeding=false;
 await theme(page,preset);await space(page,mode!=='daily');await app(page,mode==='story'?'剧本':'聊天');if(mode!=='story')await page.getByRole('button',{name:'恢复角色甲 开始 / 继续聊天',exact:true}).click();
 return {calls:()=>calls,wait:()=>expect.poll(()=>!!held).toBe(true),success:async()=>{const r=held;held=undefined;await r!.fulfill({json:envelope(mode==='story'?nodeReply:'测试回复完成。')});},fail:async(status:number,code?:string,message?:string)=>{const r=held;held=undefined;await r!.fulfill({status,json:{error:{...(code?{code}:{}),...(message?{message}:{})}}});}};
}

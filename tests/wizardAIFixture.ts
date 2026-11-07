import type {Page} from '@playwright/test';
import {isolatedApp} from './backupBrowser';
export const pacing=[{title:'关系中的共同选择',description:'以人物间不同目标的磨合推动故事，逐步揭开彼此的顾虑。',pace:'slow'},{title:'追查错置的信件',description:'由眼前的错递事件引出连续冲突，每次行动都留下具体后果。',pace:'compact'},{title:'城市暗面的发现',description:'跟随人物对城市异常的调查展开世界，以发现和抉择交替推进。',pace:'balanced'}];
export const openings=[{title:'站台的旧信',timeAndPlace:'清晨的车站站台',conflict:'一封无人认领的旧信引出疑问',connection:'主控与同行者分别认出了不同的线索'},{title:'深夜来客',timeAndPlace:'午夜的诊所门口',conflict:'陌生访客带来了矛盾的信息',connection:'主控的职业让关联角色主动求助'},{title:'雨中的重逢',timeAndPlace:'雨天的城市广场',conflict:'彼此记忆中有一处差异',connection:'主控和关联角色需要确认共同过去'}];
export const character={name:'林雾',gender:'女',appearance:'短发，灰色外套',personality:'谨慎，愿意求证',identity:'档案整理员',background:'在城市档案馆工作多年',relationship:'尚未与主控相识，可能因调查而合作'};
export const openingNode={body:'清晨的车站笼罩在薄雾里。\n\n你停在出口，看见林雾手中的旧信。她抬起头，并没有替你作出选择。',choices:['观察旧信','询问来意','检查四周','等待同行者'].map((text,i)=>({id:'ABCD'[i],text}))};
export function wizardResponse(provider:string,value:unknown,finish?:string){return provider==='gemini'?{candidates:[{finishReason:finish??'STOP',content:{parts:[{thought:true,text:'not-visible-thought'},{text:JSON.stringify(value)}]}}]}:{choices:[{finish_reason:finish??'stop',message:{content:JSON.stringify(value)}}]};}
export async function seedWizardAI(page:Page,provider='openai-compatible',step=3){
 const name='wizard-ai-'+crypto.randomUUID();await isolatedApp(page,name);
 const draft=await page.evaluate(async({provider,step})=>{const {db,usePhone}=await import('/src/store.ts');const {newWizardDraft}=await import('/src/scriptWizardDraft.ts');
  await db.apiConfigs.put({id:'wizard-api',name:'Mock API',provider,baseUrl:'https://wizard.test/v1',model:'synthetic-model',temperature:.7,maxTokens:1200,enabled:true,isDefault:true,createdAt:1,updatedAt:1});await db.apiCredentials.put({configId:'wizard-api',apiKey:'synthetic-fixture-only'});
  await db.characters.put({id:'base',name:'同行者',persona:'独立静态人物背景',speakingStyle:'简洁'});await db.worlds.put({id:'foreign',name:'其他世界',description:'不能混入的世界',createdAt:1});await db.worldProfiles.put({id:'foreign-profile',worldId:'foreign',characterId:'base',setting:'FOREIGN_RELATION_SECRET'});
  const c=await(await import('/src/chatService.ts')).getConversation('base');await db.messages.put({id:'private-daily',conversationId:c.id,role:'user',content:'DAILY_PRIVATE_CHAT',createdAt:1});
  const theme=(await db.themes.get('global'))!;await db.themes.update('global',{userIdentities:{...theme.userIdentities,daily:{name:'DAILY_IDENTITY_SECRET',bio:'不要读取',customSetting:''},'world:foreign':{name:'FOREIGN_IDENTITY_SECRET',bio:'不要读取',customSetting:''}}});
  const d=newWizardDraft();Object.assign(d,{step,title:'寻找旧信',synopsis:'故事梗概：在陌生城市寻找一封信的来历。',rules:'不得替主控作出选择。',direction:'寻找真相但不预设结局',pace:'slow',opening:'清晨在车站相遇',length:'detailed',identity:{...d.identity,name:'顾安',gender:'女',occupation:'医生',appearance:'黑色短发',personality:'温和而果断',experience:'长期救治病人'},characterIds:['base']});
  localStorage.setItem((await import('/src/scriptWizardDraft.ts')).wizardDraftKey(db.name),JSON.stringify(d));await usePhone.getState().reload();await(await import('/src/spaces.ts')).useSpaces.getState().openWorldEditor('wizard');return d;
 },{provider,step});return {name,draft,worldId:`wizard-${draft.creationToken}`};
}

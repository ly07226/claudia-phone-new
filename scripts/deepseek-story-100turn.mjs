// 100-turn live DeepSeek choice-following stress test; isolated from production saves.
// This tests model behavior with chosen actions, not the app's storyInput pipeline.
import fs from 'node:fs';
const key=process.env.DEEPSEEK_API_KEY;
if(!key)throw Error('DEEPSEEK_API_KEY missing');
const MAX_TURNS=100,MAX_INPUT=420000,MAX_OUTPUT=55000;
// E is a player-edited free-text action, not a fifth model-generated choice.
// Inject deliberate departures from the investigation at fixed checkpoints.
const E_ACTIONS=new Map([
 [5,'E：我不再追查东宫文书。我主动离开宫城，去城外投宿，不接受任何调查差事。'],
 [15,'E：我决定暂时隐姓埋名，在城外开一家茶馆，接下来优先经营茶馆和结识邻里。'],
 [30,'E：我拒绝少卿的调查邀请，明确告诉他我不参与此案，转而去拜访一位普通茶商。'],
 [45,'E：我主动写信给七皇子，表明愿意谈判，但不承诺效忠，也不回宫。'],
 [60,'E：我改变主意，不再联系七皇子，去城南救助受灾百姓。'],
 [75,'E：我决定离开京城去江南生活，沿途不主动调查宫廷案件。'],
 [90,'E：我拒绝任何强迫我回京的安排，选择在江南继续自己的生活。']
]);
const state={turn:0,history:[],usage:{input:0,output:0},stopped:null,flags:[]};
const facts=['架空黎朝。太子虞秉钧已被七皇子虞允栖刺杀，死亡不可逆。','大皇子虞憬坠崖失踪，未确认死亡，实际上活着；在封后大典后才能归京，归京前不知宫变。','七皇子逼皇帝禅位只能完成一次；封后大典只能举行一次。','不得凭传闻断言人物死亡或让人物拥有不可能知道的秘密。','主控身份不明时不得擅自确定主控职业或关系。'];
const sys='你是架空古代宫廷互动小说叙述者。只写非露骨政治剧情。遵循已确认事实和人物知识边界，不得重复已完成事件。每次只生成一轮，必须输出 JSON 对象，包含 body (120-220字)、choices (恰好四项，id依次A/B/C/D，text为玩家可执行的不同动作)。已选行动是意图而非已成功的结果。禁止捏造既往约定、暗号、承诺、交付、知情关系或已完成行动；没有已确认历史证据，不得称此前约定或方才商定。每轮承接选中行动必须出现可观察的新结果（新信息、局势变化、人物决策或明确失败代价），不能连续多轮只重复躲藏、等待、盘问、追逐而不改变局面；停滞时让既有冲突产生可信后果，不强制跳时间或替主控选择。四个选项必须提供实质不同的推进路径，至少一项能直接处理当前最重要的未决冲突。若玩家自由编辑 E 行动离开主线，应允许持续走支线，世界自行运转，不得强制把玩家带回原定调查线。';
function choose(choices,turn){
 // Deterministic, reproducible player: favor action that advances unresolved conflict;
 // fallback cycles through all options rather than selecting the same letter each turn.
 const keywords=['追查','揭露','面见','谈判','行动','确认','保护','阻止','推进','调查','进宫','传讯','求证'];
 const ranked=choices.map((c,i)=>({c,i,score:keywords.reduce((n,k)=>n+(c.text.includes(k)?1:0),0)}));
 ranked.sort((a,b)=>b.score-a.score||((a.i+turn)%4)-((b.i+turn)%4));
 return ranked[0].c;
}
for(let t=0;t<MAX_TURNS;t++){
 if(state.usage.input>=MAX_INPUT||state.usage.output>=MAX_OUTPUT){state.stopped='token cap';break;}
 const last=state.history.at(-1);
 const previous=state.history.slice(-9).map(h=>({turn:h.turn,body:h.body,selectedAction:h.selectedAction}));
 const old=state.history.slice(0,-9).filter((h,i)=>i%8===0).map(h=>({turn:h.turn,body:h.body}));
 const context={facts,confirmedHistory:previous,olderHistorySamples:old,selectedAction:last?.selectedAction??'从太子遇刺后的宫廷动荡开始，保持主控身份中立',previousChoices:last?.choices,playerAgency:'E 是玩家主动编辑的自由行动，优先承接其意图；不强制玩家回归宫廷调查。允许世界政治事件在玩家离开后自行发展，但不得把玩家写回调查队伍。'};
 let response;
 try{response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:'deepseek-chat',response_format:{type:'json_object'},messages:[{role:'system',content:sys},{role:'user',content:JSON.stringify(context)}],temperature:0.35,max_tokens:550}),signal:AbortSignal.timeout(60000)});}catch(e){state.stopped='request failure '+String(e);break;}
 if(!response.ok){let code='';try{const e=await response.json();code=String(e?.error?.code||e?.error?.type||'').slice(0,80)}catch{}state.stopped='HTTP '+response.status+' '+code;break;}
 let data;try{data=await response.json()}catch{state.stopped='invalid API response';break;}
 state.usage.input+=data.usage?.prompt_tokens||0;state.usage.output+=data.usage?.completion_tokens||0;
 let out;try{out=JSON.parse(data.choices?.[0]?.message?.content||'')}catch{state.stopped='invalid JSON at turn '+(t+1);break;}
 if(typeof out.body!=='string'||!Array.isArray(out.choices)||out.choices.length!==4||out.choices.some((c,i)=>c.id!=='ABCD'[i]||!c.text)){state.stopped='invalid schema at turn '+(t+1);break;}
 const freeText=E_ACTIONS.get(t+1);
 const selected=freeText?{id:'E',text:freeText,kind:'custom'}:choose(out.choices,t);
 const flags=[];
 if(/虞秉钧复活|太子死而复生/.test(out.body))flags.push('possible resurrection');
 if(t<20&&/虞憬归京|虞憬回京/.test(out.body))flags.push('possible early return');
 const previousE=[...state.history].reverse().find(h=>h.selectedAction?.id==='E');
 const followup=previousE?{fromTurn:previousE.turn,action:previousE.selectedAction.text,body:out.body,manualReviewRequired:true}:null;
 state.history.push({turn:t+1,body:out.body,choices:out.choices,selectedAction:{id:selected.id,text:selected.text,kind:selected.kind||'choice'},followup,flags});
 state.turn=t+1;if(flags.length)state.flags.push({turn:t+1,flags});
 if((t+1)%10===0)console.log('Progress',t+1,'tokens',JSON.stringify(state.usage));
}
fs.mkdirSync('test-results',{recursive:true});
fs.writeFileSync('test-results/deepseek-story-100turn.json',JSON.stringify(state,null,2));
console.log('STORY_TEST_SUMMARY '+JSON.stringify({turns:state.turn,usage:state.usage,stopped:state.stopped,flags:state.flags}));
if(state.turn!==MAX_TURNS||state.stopped)process.exitCode=1;

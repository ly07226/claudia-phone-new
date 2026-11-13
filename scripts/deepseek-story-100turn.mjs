// 100-turn live DeepSeek choice-following stress test; isolated from production saves.
// This tests model behavior with chosen actions, not the app's storyInput pipeline.
import fs from 'node:fs';
const key=process.env.DEEPSEEK_API_KEY;
if(!key)throw Error('DEEPSEEK_API_KEY missing');
const MAX_TURNS=100,MAX_INPUT=240000,MAX_OUTPUT=55000;
const state={turn:0,history:[],usage:{input:0,output:0},stopped:null,flags:[]};
const facts=['架空黎朝。太子虞秉钧已被七皇子虞允栖刺杀，死亡不可逆。','大皇子虞憬坠崖失踪，未确认死亡，实际上活着；在封后大典后才能归京，归京前不知宫变。','七皇子逼皇帝禅位只能完成一次；封后大典只能举行一次。','不得凭传闻断言人物死亡或让人物拥有不可能知道的秘密。','主控身份不明时不得擅自确定主控职业或关系。'];
const sys='你是架空古代宫廷互动小说叙述者。只写非露骨政治剧情。遵循已确认事实和人物知识边界，不得重复已完成事件。每次只生成一轮，必须输出 JSON 对象，包含 body (120-220字)、choices (恰好四项，id依次A/B/C/D，text为玩家可执行的不同动作)。已选行动是意图而非已成功的结果。';
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
 const context={facts,confirmedHistory:previous,olderHistorySamples:old,selectedAction:last?.selectedAction??'从太子遇刺后的宫廷动荡开始，保持主控身份中立',previousChoices:last?.choices};
 let response;
 try{response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:'deepseek-chat',response_format:{type:'json_object'},messages:[{role:'system',content:sys},{role:'user',content:JSON.stringify(context)}],temperature:0.35,max_tokens:550}),signal:AbortSignal.timeout(60000)});}catch(e){state.stopped='request failure '+String(e);break;}
 if(!response.ok){let code='';try{const e=await response.json();code=String(e?.error?.code||e?.error?.type||'').slice(0,80)}catch{}state.stopped='HTTP '+response.status+' '+code;break;}
 let data;try{data=await response.json()}catch{state.stopped='invalid API response';break;}
 state.usage.input+=data.usage?.prompt_tokens||0;state.usage.output+=data.usage?.completion_tokens||0;
 let out;try{out=JSON.parse(data.choices?.[0]?.message?.content||'')}catch{state.stopped='invalid JSON at turn '+(t+1);break;}
 if(typeof out.body!=='string'||!Array.isArray(out.choices)||out.choices.length!==4||out.choices.some((c,i)=>c.id!=='ABCD'[i]||!c.text)){state.stopped='invalid schema at turn '+(t+1);break;}
 const selected=choose(out.choices,t);
 const flags=[];
 if(/虞秉钧复活|太子死而复生/.test(out.body))flags.push('possible resurrection');
 if(t<20&&/虞憬归京|虞憬回京/.test(out.body))flags.push('possible early return');
 state.history.push({turn:t+1,body:out.body,choices:out.choices,selectedAction:{id:selected.id,text:selected.text},flags});
 state.turn=t+1;if(flags.length)state.flags.push({turn:t+1,flags});
 if((t+1)%10===0)console.log('Progress',t+1,'tokens',JSON.stringify(state.usage));
}
fs.mkdirSync('test-results',{recursive:true});
fs.writeFileSync('test-results/deepseek-story-100turn.json',JSON.stringify(state,null,2));
console.log('STORY_TEST_SUMMARY '+JSON.stringify({turns:state.turn,usage:state.usage,stopped:state.stopped,flags:state.flags}));
if(state.turn!==MAX_TURNS||state.stopped)process.exitCode=1;

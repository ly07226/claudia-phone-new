// Isolated DeepSeek narrative stress test. Does not touch production saves.
const key=process.env.DEEPSEEK_API_KEY;
if(!key) throw Error('DEEPSEEK_API_KEY missing');
const fs=await import('node:fs');
const maxTurns=30, maxInput=60000, maxOutput=12000;
let inputUsed=0,outputUsed=0;
const events=[
'太子虞秉钧在开场被七皇子虞允栖刺杀，已确认死亡，不得复活',
'大皇子虞憬在北地坠崖，世人只知道失踪，不能宣称已确认死亡',
'虞憬其实活着，但宫中人物不得提前知道；他须在封后大典之后才归京',
'七皇子迫使皇帝禅位是一次性事件，完成后不得再次上演',
'封后大典是一次性事件，完成后不得再次举行'
];
const system='你是架空黎朝互动小说叙述者。只写非色情政治剧情。严格遵守人物知识边界、已完成事件和时间线。每轮仅输出 JSON 对象 {"body":"100至180字剧情","choices":[{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}]}。不得提前宣告未发生的事情。';
const state={turn:0,history:[],checks:[],usage:{input:0,output:0},stopped:null};
const pick=(t)=>t<5?'调查太子遇刺后的朝局':t<12?'应对北地失踪消息与宫廷猜疑':t<18?'推进禅位谈判，只有明确完成才视为完成':t<24?'准备并举行一次封后大典': '在封后大典后安排虞憬归京并面对政变后果';
for(let i=0;i<maxTurns;i++){
 if(inputUsed>=maxInput||outputUsed>=maxOutput){state.stopped='token cap reached';break;}
 const previous=state.history.slice(-7).map(x=>({turn:x.turn,body:x.body,action:x.action}));
 const context={world:'黎朝',rules:events,completed:state.history.filter(x=>x.completed).map(x=>({turn:x.turn,event:x.completed})),history:previous,action:pick(i)};
 const messages=[{role:'system',content:system},{role:'user',content:JSON.stringify(context)}];
 const requestedOutput=Math.min(380,maxOutput-outputUsed);
 if(requestedOutput<160){state.stopped='output cap reached';break;}
 let res;
 try{
  res=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-chat',messages,response_format:{type:'json_object'},max_tokens:requestedOutput,temperature:0.35}),signal:AbortSignal.timeout(60000)});
 }catch(e){state.stopped='request error: '+String(e);break;}
 if(!res.ok){let reason='';try{const failure=await res.json();reason=String(failure?.error?.code||failure?.error?.type||failure?.error?.message||'').slice(0,100)}catch{}state.stopped='HTTP '+res.status+(reason?' ('+reason+')':'');break;}
 const data=await res.json(),usage=data.usage||{};
 inputUsed+=usage.prompt_tokens||0;outputUsed+=usage.completion_tokens||0;
 const raw=data.choices?.[0]?.message?.content||'';
 let parsed;
 try{parsed=JSON.parse(raw)}catch{state.stopped='invalid JSON at turn '+(i+1);break;}
 if(typeof parsed.body!=='string'||!Array.isArray(parsed.choices)||parsed.choices.length!==4){state.stopped='invalid response structure at turn '+(i+1);break;}
 const body=parsed.body;
 const completed= /(?:禅位诏书已颁|正式禅位|完成禅位)/.test(body)?'禅位':/(?:封后大典礼成|封后礼成)/.test(body)?'封后':null;
 const warnings=[];
 if(i<24&&/(?:虞憬归京|虞憬回京|虞憬返回京城)/.test(body))warnings.push('possible premature return');
 if(/(?:虞秉钧复活|太子死而复生)/.test(body))warnings.push('possible resurrection');
 if(i>0&&state.history.some(x=>x.completed==='禅位')&&completed==='禅位')warnings.push('possible repeated abdication');
 if(i>0&&state.history.some(x=>x.completed==='封后')&&completed==='封后')warnings.push('possible repeated investiture');
 state.history.push({turn:i+1,action:pick(i),body,choices:parsed.choices,completed,warnings});
 state.turn=i+1;
 if(warnings.length)state.checks.push({turn:i+1,warnings});
 if(i%5===4)console.log('Completed turns',i+1,'tokens',inputUsed,outputUsed);
}
state.usage={input:inputUsed,output:outputUsed};
fs.mkdirSync('test-results',{recursive:true});
fs.writeFileSync('test-results/deepseek-story-30turn.json',JSON.stringify(state,null,2));
console.log('STORY_TEST_SUMMARY '+JSON.stringify({turns:state.turn,usage:state.usage,stopped:state.stopped,flagged:state.checks}));
if(state.turn!==maxTurns||state.stopped){console.error('STORY_TEST_FAILED '+JSON.stringify({turns:state.turn,reason:state.stopped||'incomplete'}));process.exitCode=1;}

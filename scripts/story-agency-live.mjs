import fs from 'node:fs';
const key=process.env.DEEPSEEK_API_KEY;
if(!key)throw Error('DEEPSEEK_API_KEY unavailable');
const src=fs.readFileSync('src/storyContext.ts','utf8');
const match=src.match(/export const storyPrompt=`([\\s\\S]*?)`;/);
if(!match)throw Error('Production storyPrompt not found');
const prompt=match[1];
const arcs=[
 {name:'silent',history:'七皇子放下茶杯，等候回答。',action:'我抬头看着七皇子，没有说话。'},
 {name:'intimacy',history:'沈砚与玩家均已成年，双方此前明确互有好感，沈砚曾主动表白，玩家表示愿意慢慢靠近。如今沈砚坐在窗边，等候回应。',action:'我主动亲吻了沈砚，然后停下来，等他回应。'},
 {name:'depart-mainline',history:'宫廷调查仍未结束，但玩家已经决定不再参与。',action:'我明确拒绝继续调查，打算离开京城，在江南开一家茶馆，今后优先经营茶馆。'},
 {name:'daily-life',history:'玩家已经在江南经营茶馆，店内新到一批茶叶，邻居提出合作建议。',action:'我问邻居合作的具体条件，暂时不作决定。'}
];
const results=[];const started=new Date().toISOString();
fs.mkdirSync('artifacts',{recursive:true});
function save(){fs.writeFileSync('artifacts/story-agency-live.json',JSON.stringify({timestamp:started,source:'production storyPrompt; 100 sequential DeepSeek turns, four independent 25-turn arcs',requestedTurns:100,completedTurns:results.length,results},null,2));}
for(let i=0;i<100;i++){
 const arc=arcs[Math.floor(i/25)],turn=i%25+1;
 const previous=results.filter(r=>r.arc===arc.name);
 const last=previous.at(-1);
 const selected=turn===1?arc.action:turn%5===0?(
  arc.name==='depart-mainline'?'我继续专注茶馆经营，不接受回到宫廷调查的安排。':
  arc.name==='intimacy'?'我停下来，等待沈砚自己决定如何回应。':
  arc.name==='silent'?'我继续沉默，观察对方的反应。':
  '我先听对方把话说完，不立刻答应。'
 ):last?.choiceTexts?.[(turn-2)%4]||'我继续观察局势，不作其他决定。';
 const history=turn===1?[{body:arc.history}]:previous.slice(-6).map((r,j)=>({body:r.body,selectedAction:j===previous.slice(-6).length-1?undefined:{kind:'custom',text:previous[previous.length-6+j+1]?.selectedAction||''}}));
 const input={definition:{name:'架空古代互动故事',description:'所有人物均为成年人。玩家主控角色的行动和心理只由玩家本人决定。',rules:'禁止替玩家说话、行动、反应或同意。',background:'京城局势变化，但玩家可自行选择生活方向。',script:{narration:'second'}},confirmedHistory:history,selectedAction:{kind:'custom',text:selected},playerAgencyContract:{authorizedNow:selected,authorizationScope:'只授权明确文字中的动作或意图；长期目标不授权执行全部步骤；不得擅自添加玩家言语、行动、心理、生理反应或同意',narrativeBoundary:'NPC可自主回应并推进外部世界；遇到玩家必须选择的下一步立即停住，不得跳时间替玩家完成',selfCheck:'正文中每个玩家新动作或对白必须可追溯到 authorizedNow 或 confirmedHistory'},narrativeLength:{mode:'standard',targetChineseCharacters:'800～1500',appliesTo:'仅 body 正文'}};
 let result={turn:i+1,arc:arc.name,arcTurn:turn,selectedAction:selected,length:0,validJson:false,choices:0,withinTarget:false,body:'',choiceTexts:[],usage:null,error:null};
 try{
  const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-chat',temperature:0.35,max_tokens:4200,response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(input)}]})});
  if(!response.ok)throw Error('HTTP '+response.status+' '+(await response.text()).slice(0,300));
  const data=await response.json();const raw=data.choices?.[0]?.message?.content||'';let output;
  try{output=JSON.parse(raw);}catch{output={body:'',choices:[],error:'invalid JSON',rawContent:raw.slice(0,12000)};}
  const body=typeof output.body==='string'?output.body:'',choices=Array.isArray(output.choices)?output.choices:[];
  result={...result,length:[...body].length,validJson:!output.error,choices:choices.length,withinTarget:[...body].length>=800&&[...body].length<=1500,body,choiceTexts:choices.map(c=>c.text),usage:data.usage,error:output.error||null,rawContent:output.rawContent||null};
 }catch(e){result.error=String(e);}
 results.push(result);save();
 console.log('TURN '+(i+1)+'/100 '+arc.name+' chars='+result.length+' choices='+result.choices+' error='+(result.error||'none'));
 if(result.error&&/HTTP 401|HTTP 402|HTTP 403|insufficient balance/i.test(result.error)){console.log('STOP: API access or balance failure');break;}
}
save();
console.log('COMPLETED '+results.length+'/100; invalid='+results.filter(r=>!r.validJson||r.choices!==4).length+'; under800='+results.filter(r=>r.length<800).length);
if(results.length!==100||results.some(r=>!r.validJson||r.choices!==4))process.exitCode=1;

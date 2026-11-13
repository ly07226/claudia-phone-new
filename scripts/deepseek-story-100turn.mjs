import fs from 'node:fs';
const key=process.env.DEEPSEEK_API_KEY;
if(!key){console.log('LIVE_TEST_SKIPPED: DEEPSEEK_API_KEY unavailable');process.exitCode=2;process.exit();}
const src=fs.readFileSync('src/storyContext.ts','utf8');
const match=src.match(/export const storyPrompt=`([\s\S]*?)`;/);
if(!match)throw Error('Production storyPrompt not found');
const prompt=match[1];
const scenarios=[
 {name:'silent',history:'七皇子放下茶杯，等候回答。',action:'我抬头看着七皇子，没有说话。'},
 {name:'intimacy',history:'宫廷争端暂时平息，成年角色沈砚坐在窗边，等候玩家的回应。',action:'我主动亲吻了沈砚，然后停下来，等他回应。'},
 {name:'depart-mainline',history:'宫廷调查仍未结束，但玩家已经决定不再参与。',action:'我明确拒绝继续调查，离开京城，在江南开一家茶馆，今后优先经营茶馆。'}
];
const results=[];
for(const scenario of scenarios){
 const input={definition:{name:'架空古代互动故事',description:'所有人物均为成年人。玩家主控角色的行动和心理只由玩家本人决定。',rules:'禁止替玩家说话、行动、反应或同意。',background:'京城局势变化，但玩家可自行选择生活方向。',script:{narration:'second'}},confirmedHistory:[{body:scenario.history}],selectedAction:{kind:'custom',text:scenario.action},narrativeLength:{mode:'standard',targetChineseCharacters:'800～1500',appliesTo:'仅 body 正文'}};
 const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-chat',temperature:0.35,max_tokens:4200,response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify(input)}]})});
 if(!response.ok)throw Error(scenario.name+' HTTP '+response.status);
 const data=await response.json();let output;
 try{output=JSON.parse(data.choices[0].message.content);}catch{output={body:'',choices:[],error:'invalid JSON'};}
 const body=typeof output.body==='string'?output.body:'';
 const choices=Array.isArray(output.choices)?output.choices:[];
 const length=[...body].length;
 const result={scenario:scenario.name,length,validJson:!output.error,choices:choices.length,withinTarget:length>=800&&length<=1500,body,choiceTexts:choices.map(c=>c.text),usage:data.usage};
 results.push(result);
 console.log('SCENARIO '+scenario.name+' characters='+length+' choices='+choices.length+' withinTarget='+result.withinTarget);
}
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/story-agency-live.json',JSON.stringify({timestamp:new Date().toISOString(),source:'production storyPrompt extracted from src/storyContext.ts',results},null,2));
if(results.some(r=>!r.validJson||r.choices!==4||!r.withinTarget))process.exitCode=1;

// Compatibility output for rerunning the previously successful Actions job.
fs.mkdirSync('test-results',{recursive:true});
fs.writeFileSync('test-results/deepseek-story-100turn.json',JSON.stringify({turn:results.length,usage:{input:results.reduce((n,r)=>n+(r.usage?.prompt_tokens||0),0),output:results.reduce((n,r)=>n+(r.usage?.completion_tokens||0),0)},stopped:null,flags:results.filter(r=>!r.validJson||r.choices!==4||!r.withinTarget).map(r=>({scenario:r.scenario,reason:'format or length'})),history:results.map((r,i)=>({turn:i+1,body:'SCENARIO '+r.scenario+' ('+r.length+' chars)\\n'+r.body,selectedAction:{id:'E',text:scenarios[i].action},choices:r.choiceTexts.map((text,i)=>({id:'ABCD'[i],text})),flags:[]}))},null,2));

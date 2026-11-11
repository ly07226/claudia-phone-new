import {test,expect} from '@playwright/test';
import {deriveSimulatorProgress} from '../src/wizardSimulatorProgress';
import {simulatorAuditStatus} from '../src/wizardSimulatorAudit';
import {applySimulatorChanges} from '../src/wizardSimulatorState';
import type {StoryNode} from '../src/storyTypes';

function node(sequence:number,parentNodeId?:string):StoryNode{
 return {id:'node-'+sequence,worldId:'w',sessionId:'s',sequence,parentNodeId,
  body:'body',choices:[{id:'node-'+sequence+':A',label:'A',text:'探索'}],
  requestId:'req-'+sequence,createdAt:sequence,definitionRevision:1};
}
test('simulator progress tracks confirmed choice, not an unchosen option',()=>{
 const first=node(1),second={...node(2,first.id),action:{kind:'choice' as const,choiceId:first.choices[0].id}};
 expect(deriveSimulatorProgress([first,second]).confirmedActions).toEqual([{sequence:2,kind:'choice',text:'探索'}]);
 expect(deriveSimulatorProgress([first]).confirmedActions).toEqual([]);
});
test('simulator progress stays bounded without dropping saved path',()=>{
 const path:StoryNode[]=[node(1)];
 for(let i=2;i<=35;i++)path.push({...node(i,path.at(-1)!.id),action:{kind:'custom',text:'step-'+i}});
 const result=deriveSimulatorProgress(path);
 expect(result.revision).toBe(35);
 expect(result.confirmedActions).toHaveLength(24);
 expect(result.omittedActions).toBe(10);
 expect(path).toHaveLength(35);
});
test('audit refuses missing reviews and duplicated reviews',()=>{
 const chunks=[{id:'0',start:0,end:3,text:'abc',headings:[]}];
 const review={id:'s:0',sourceId:'s',sourceLength:3,sourceName:'s',
  review:{chunkIndex:0,chunkCount:1,start:0,end:3,findings:[],rejected:0},savedAt:1};
 expect(simulatorAuditStatus(chunks,[],[]).ready).toBe(false);
 expect(simulatorAuditStatus(chunks,[review],[]).ready).toBe(true);
 const duplicate={...review,id:'duplicate'};
 expect(simulatorAuditStatus(chunks,[review,duplicate],[]).ready).toBe(false);
});

test('rejected hallucinated quotes do not permanently block approved evidence',()=>{
 const chunks=[{id:'chunk-0',start:0,end:3,text:'abc',headings:[]}];
 const review={id:'s:0',sourceId:'s',sourceLength:3,sourceName:'s',
  review:{chunkIndex:0,chunkCount:1,start:0,end:3,findings:[],rejected:2},savedAt:1};
 const status=simulatorAuditStatus(chunks,[review],[]);
 expect(status.rejectedEvidence).toBe(2);
 expect(status.ready).toBe(true);
});
test('invalid review evidence fails closed',()=>{
 const chunks=[{id:'chunk-0',start:0,end:3,text:'abc',headings:[]}];
 const review={id:'s:0',sourceId:'s',sourceLength:3,sourceName:'s',
  review:{chunkIndex:0,chunkCount:1,start:0,end:3,findings:[{kind:'secret',quote:'xyz',start:0,end:3,interpretation:'bad',confidence:'source-verified' as const}],rejected:0},savedAt:1};
 expect(simulatorAuditStatus(chunks,[review],[]).ready).toBe(false);
});

test('generic world state updates without mutating earlier snapshot',()=>{
 const initial={supplies:5,weather:'rain',doorOpen:false};
 const next=applySimulatorChanges(initial,[{key:'supplies',op:'increment',value:-2},{key:'doorOpen',op:'set',value:true}]);
 expect(next.supplies).toBe(3);
 expect(next.doorOpen).toBe(true);
 expect(initial.supplies).toBe(5);
});
test('generic world state rejects unsafe keys and invalid increments',()=>{
 expect(()=>applySimulatorChanges({},[{key:'__proto__',op:'set',value:'bad'}])).toThrow();
 expect(()=>applySimulatorChanges({supplies:2},[{key:'supplies',op:'increment',value:Infinity}])).toThrow();
 expect(()=>applySimulatorChanges({weather:'rain'},[{key:'weather',op:'increment',value:1}])).toThrow();
});

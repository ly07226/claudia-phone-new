import type {StoryNode,StoryAction} from './storyTypes';

/** Generic, replayable state of confirmed player choices, not inferred world facts.
 * Derived from the active branch so regeneration/withdrawal cannot leave stale state. */
export interface SimulatorProgress {
 revision:number;
 confirmedActions:{sequence:number;kind:StoryAction['kind'];text:string}[];
 lastConfirmedNode?:string;
}
export function deriveSimulatorProgress(path:readonly StoryNode[]):SimulatorProgress{
 const confirmedActions:SimulatorProgress['confirmedActions']=[];
 for(const node of path){
  const action=node.action;
  if(!action)continue;
  if(action.kind==='custom')confirmedActions.push({sequence:node.sequence,kind:'custom',text:action.text});
  else {
   const parent=path.find(n=>n.id===node.parentNodeId);
   const choice=parent?.choices.find(c=>c.id===action.choiceId);
   if(!choice)throw Error('模拟器历史选项已失效，不能推导状态。');
   confirmedActions.push({sequence:node.sequence,kind:'choice',text:choice.text});
  }
 }
 return {revision:path.length,confirmedActions,lastConfirmedNode:path.at(-1)?.id};
}

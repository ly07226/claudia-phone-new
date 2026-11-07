import {storyLimits,type StoryAction,type StoryNode} from './storyTypes';
/** Accept legacy choice strings without rewriting existing B1 records. */
export function normalizeStoryAction(value:string|StoryAction|undefined):StoryAction|undefined {
 if(value===undefined)return undefined;
 if(typeof value==='string')return {kind:'choice',choiceId:value};
 if(value&&value.kind==='choice'&&typeof value.choiceId==='string'&&value.choiceId.length>0&&value.choiceId.length<=2000&&Object.keys(value).every(k=>['kind','choiceId'].includes(k)))return {kind:'choice',choiceId:value.choiceId};
 if(value&&value.kind==='custom'&&typeof value.text==='string'&&!!value.text.trim()&&value.text.length<=storyLimits.action&&Object.keys(value).every(k=>['kind','text'].includes(k)))return {kind:'custom',text:value.text.trim()};
 throw Error('请填写有效行动，最多2000字。');
}
export function storyActionText(parent:StoryNode,child:StoryNode){
 const action=child.action??(child.fromChoiceId?{kind:'choice' as const,choiceId:child.fromChoiceId}:undefined);
 return action?.kind==='custom'?{kind:'custom',text:action.text}:action?.kind==='choice'?{kind:'choice',label:parent.choices.find(c=>c.id===action.choiceId)?.label,text:parent.choices.find(c=>c.id===action.choiceId)?.text}:undefined;
}

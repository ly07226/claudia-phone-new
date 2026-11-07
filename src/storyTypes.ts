import type {ScriptConfig} from './scriptTypes';
export type StoryLength='brief'|'standard'|'detailed';
export interface StoryPreferences {length:StoryLength}
export type StoryAction={kind:'choice';choiceId:string}|{kind:'custom';text:string};
/** Snapshot of the progress the user actually confirmed; not persisted. */
export interface StoryExpectedProgress {sessionId?:string;headNodeId?:string;revision:number}
export interface StoryDraft {headNodeId:string;mode:'choice'|'custom';customText:string;choiceId?:string}
export const storyLengths={brief:{label:'精简',target:'400～800',tokens:4000},standard:{label:'标准',target:'800～1500',tokens:7000},detailed:{label:'详细',target:'1500～2500',tokens:11000}} as const;
export interface StoryDefinition {name:string;description:string;rules:string;background:string;script:ScriptConfig}
export interface StoryChoice {id:string;label:'A'|'B'|'C'|'D';text:string}
export interface StoryNode {action?:StoryAction;narrativeLength?:StoryLength;id:string;worldId:string;sessionId:string;parentNodeId?:string;fromChoiceId?:string;body:string;choices:StoryChoice[];createdAt:number;requestId:string;definitionRevision:number;sequence:number}
export interface StorySession {actionDraft?:StoryDraft;id:string;worldId:string;headNodeId?:string;revision:number;status:'idle'|'generating'|'ready'|'failed';definitionRevision:number;definition:StoryDefinition;createdAt:number;updatedAt:number;pending?:{token:string;headNodeId?:string;revision:number;expiresAt:number};error?:'cancelled'|'request'|'invalid'|'stale'|'budget'}
export const storySchemas={storySessions:'id,&worldId',storyNodes:'id,worldId,sessionId,parentNodeId,&requestId'} as const;
export const storyLimits={body:12000,choice:400,action:2000,inputBytes:48000,outputChars:18000,outputTokens:11000,leaseMs:120000,nodes:2000};

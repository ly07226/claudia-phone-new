/** Logical memory records live inside their owning Conversation; no v6 table migration. */
export type MemoryKind='core'|'long'|'short';
export type StoredMemoryKind=Exclude<MemoryKind,'short'>;
export type MemorySource='manual'|'auto';
interface Owner {conversationId:string;characterId:string}
export type MemoryScope=(Owner&{mode:'daily';spaceId:'daily';worldId?:never;timelineId?:never;epoch?:never})|(Owner&{mode:'world';spaceId:`world:${string}`;worldId:string;timelineId:string;epoch:number});
/** Immutable revision. id identifies the same logical memory across local overrides. */
export interface MemoryEntry {
 id:string;revision:number;scope:MemoryScope;kind:StoredMemoryKind;source:MemorySource;
 content:string;deleted:boolean;anchorNodeId?:string;sourceReceiptId?:string;createdAt:number;updatedAt:number;
}
export interface MemoryFork {
 timelineId:string;epoch:number;parentTimelineId?:string;sharedHeadNodeId?:string;
 /** Sealed before the first memory write after this existing chat fork. */
 inheritThroughRevision:number;
 /** Existing fork boundary for successful summary receipts, not a new timeline. */
 summaryRevisionAtFork?:number;
}
export interface MemoryStore {version:1;revision:number;entries:MemoryEntry[];forks:MemoryFork[]}
export interface MemoryInput {kind:StoredMemoryKind;content:string;source?:MemorySource;sourceReceiptId?:string}
export interface EffectiveMemory extends MemoryEntry {inherited:boolean}
export interface ShortMemoryItem {messageId:string;variantId?:string;nodeId?:string;role:'user'|'assistant';content:string;assetIds:string[];createdAt:number}
export interface ShortMemory {
 summaries?:{text:string;createdAt:number;throughNodeId:string}[];
 kind:'short';scope:MemoryScope;
 /** Context provenance only; daily stored memories never branch on these fields. */
 context:{timelineId?:string;epoch:number;revision?:number;headNodeId?:string};
 messages:ShortMemoryItem[];
}
export const memoryLimits={events:20000,entryChars:12000,totalChars:10000000,forks:16384,shortMessages:200};
export const emptyMemoryStore=():MemoryStore=>({version:1,revision:0,entries:[],forks:[]});

export type QqContextMessage={role:'system'|'user'|'assistant';content:string};
export type QqMemoryDocument={id:string;kind:'core'|'long'|'summary'|'lore'|'history';content:string;source?:'manual'|'auto';type?:'fact'|'belief'|'speculation'|'pending';updatedAt?:number;sourceReceiptId?:string};
export type QqContextData={documents:QqMemoryDocument[];includedQqIds:string[];includedQqReplyIds?:string[];conversationId:string;characterId:string;timelineId:string;epoch:number};
export type QqHistoryRow={id:string;direction:string;body:string;status:string;received_at:string;in_reply_to?:string|null};
export function contextPatch(previous:QqContextMessage[],next:QqContextMessage[]):{keep:number;append:QqContextMessage[]};
export function applyContextPatch(previous:QqContextMessage[],patch:{keep:number;append:QqContextMessage[]}):QqContextMessage[];
export function validContext(value:unknown):value is QqContextMessage[];
export function validContextData(value:unknown):value is QqContextData;
export function documentPatch(previous:QqMemoryDocument[],next:QqMemoryDocument[]):{remove:string[];upsert:QqMemoryDocument[]};
export function applyDocumentPatch(previous:QqMemoryDocument[],patch:{remove:string[];upsert:QqMemoryDocument[]}):QqMemoryDocument[];
export function recallTerms(text:string):string[];
export function qqRequestContext(snapshot:QqContextMessage[],data:QqContextData|null,recent:QqHistoryRow[],recalled:QqHistoryRow[],query:string):QqContextMessage[];

export function prepareQqRequestContext(snapshot:QqContextMessage[],data:QqContextData|null,recent:QqHistoryRow[],recalled:QqHistoryRow[],query:string):Promise<QqContextMessage[]>;

export function compareQqCursor(a:{at:string;id:string;part?:number},b:{at:string;id:string;part?:number}):number;

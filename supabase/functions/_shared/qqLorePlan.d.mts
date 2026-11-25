import type {Lorebook,LoreEntry} from '../../../src/loreTypes';
import type {Message,ContextMessage} from '../../../src/chatTypes';
export function loreScanMessages(entry:LoreEntry,book:Lorebook,history:Message[]):Message[];
export function planLore(candidates:{entry:LoreEntry;book:Lorebook}[],history:Message[],remainingBudget?:number,random?:()=>number,regex?:Record<string,unknown>):{entries:LoreEntry[]};
export function injectLore(system:string,history:ContextMessage[],entries:LoreEntry[]):ContextMessage[];
export const regexWorkerSource:string;

export function historyTerms(text:string):string[];
export function expandQqHistoryQuery(text:string):string[];

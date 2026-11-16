import type {Conversation} from './chatTypes';
import {memoryLimits} from './memoryTypes';
import {summaryLimits} from './memorySummaryTypes';
export const summaryCapacityKey=(c:Conversation)=>JSON.stringify([memoryLimits.events,memoryLimits.totalChars,summaryLimits.receipts,c.memoryStore?.entries.length??0,(c.memoryStore?.entries??[]).reduce((n,e)=>n+e.content.length,0),c.memorySummary?.receipts.length??0]);
export const summaryCapacityRecovered=(c:Conversation)=>!!c.memorySummary?.capacityBlocked&&c.memorySummary.capacityBlocked!==summaryCapacityKey(c);
export const summaryCapacityFull=(c:Conversation)=>(c.memoryStore?.entries.length??0)>=memoryLimits.events||(c.memoryStore?.entries??[]).reduce((n,e)=>n+e.content.length,0)>=memoryLimits.totalChars||(c.memorySummary?.receipts.length??0)>=summaryLimits.receipts;

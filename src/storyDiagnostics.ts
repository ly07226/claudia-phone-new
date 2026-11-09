/** Bounded numeric/fixed-code diagnostics only. Never body, key, URL, or IDs. */
export interface StoryGenerationDiagnostic {
 sequence:number;outcome:'complete'|'failed';length:'brief'|'standard'|'detailed';
 inputBytes:number;configuredOutputTokens:number;outputTokenLimit:number;
 finishReason?:string;returnedOutputTokens?:number;responseCharacters?:number;
 bodyCharacters?:number;chineseCharacters?:number;belowTarget?:boolean;
 recentNodes:number;omittedNodes:number;memoryExcerpts:number;
}
const records:StoryGenerationDiagnostic[]=[];let sequence=0;
export function recordStoryGeneration(value:Omit<StoryGenerationDiagnostic,'sequence'>){records.push({...value,sequence:++sequence});if(records.length>20)records.shift();console.info('[story-generation]',records.at(-1));}
export function getStoryGenerationDiagnostics(){return structuredClone(records);}

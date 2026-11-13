import type {StoryNode} from './storyTypes';
/** Numeric hints only, not a semantic judge. Never reject, edit, or retry a reply.
 * Similar options may be legitimate; body repetition may be a flashback. */
export function inspectStoryRepetition(body:string,choices:readonly {text:string}[],path:readonly StoryNode[]){
 const recent=path.slice(-3),offered=recent.flatMap(n=>n.choices.map(c=>c.text));
 const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
 const pairs=(text:string)=>new Set(Array.from({length:Math.max(0,text.length-1)},(_,i)=>text.slice(i,i+2)));
 const near=(a:string,b:string)=>{a=normalize(a);b=normalize(b);if(!a||!b)return false;if(a===b)return true;if(Math.min(a.length,b.length)<8)return false;const x=pairs(a),y=pairs(b);return 2*[...x].filter(k=>y.has(k)).length/(x.size+y.size)>=.9;};
 return {exactHistoricalBodyRepeat:path.some(n=>n.body===body),exactRecentBodyRepeat:recent.some(n=>n.body===body),exactRecentChoiceMatches:choices.filter(c=>offered.some(text=>text===c.text)).length,nearRecentChoiceMatches:choices.filter(c=>offered.some(text=>near(text,c.text))).length};
}

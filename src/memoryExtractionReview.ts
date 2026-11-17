/** Conservative quality gate for auxiliary story-event extraction.
 * This is a structural check, not a claim that an LLM's interpretation is true.
 * Never infer relationship status from sentiment or missing evidence.
 */
export type ExtractionReview={accepted:boolean;reasons:string[];eventCount:number};
export function reviewExtractedEvents(source:string,events:string,maxEvents=5):ExtractionReview{
 const reasons:string[]=[];
 const lines=events.split(/\n+/).map(s=>s.trim()).filter(Boolean);
 if(!source.trim())reasons.push('empty-source');
 if(!Number.isInteger(maxEvents)||maxEvents<1)reasons.push('invalid-limit');
 if(lines.length>maxEvents)reasons.push('too-many-events');
 if(events.length>4000)reasons.push('oversized-events');
 if(lines.some(s=>s.length>600))reasons.push('oversized-item');
 if(lines.some(s=>/^(`{3}|\{|\[)/.test(s)))reasons.push('unexpected-format');
 if(lines.some(s=>/^(?:无|没有|暂无)(?:重要)?(?:事件|变化|记忆)[。.!！]*$/.test(s)))reasons.push('empty-placeholder');
 return {accepted:reasons.length===0,reasons,eventCount:lines.length};
}

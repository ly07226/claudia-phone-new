import {test,expect} from '@playwright/test';
import {reviewExtractedEvents} from '../src/memoryExtractionReview';
test('event extraction review accepts concise event and empty event set',()=>{
 expect(reviewExtractedEvents('她否认说过喜欢他','她否认曾表达喜欢，实际感情尚未确认。').accepted).toBe(true);
 expect(reviewExtractedEvents('普通寒暄','').accepted).toBe(true);
});
test('event extraction review rejects oversized or fabricated empty placeholder',()=>{
 expect(reviewExtractedEvents('原文','没有重要事件').reasons).toContain('empty-placeholder');
 expect(reviewExtractedEvents('原文',Array.from({length:6},(_,i)=>'事件'+i).join('\n')).reasons).toContain('too-many-events');
 expect(reviewExtractedEvents('原文','x'.repeat(4010)).reasons).toContain('oversized-events');
});

test('quoted evidence must appear in the source',()=>{
 expect(reviewExtractedEvents('他说：“我没有答应离开。”','他说过“我没有答应离开”，离开仍未确定。').accepted).toBe(true);
 expect(reviewExtractedEvents('他说：“我没有答应离开。”','他说过“我已经答应离开”，离开已确定。').reasons).toContain('unsupported-quotation');
});
test('paraphrases are not falsely certified as semantically verified',()=>{
 const review=reviewExtractedEvents('他否认自己答应离开。','他答应离开了。');
 expect(review.accepted).toBe(true);
 // This is a known limitation: structural review cannot prove paraphrase truth.
});

test('quoted source evidence ignores whitespace and punctuation but not negation',()=>{
 const source='他说：“我 没有\n答应离开。”';
 expect(reviewExtractedEvents(source,'他明确说过“我没有答应离开”。').accepted).toBe(true);
 expect(reviewExtractedEvents(source,'他明确说过“我已经答应离开”。').reasons).toContain('unsupported-quotation');
});
test('one unsupported quotation rejects the whole batch',()=>{
 const source='她说：“明天再谈。”';
 const events='她说“明天再谈”。\n他表示“我们已经结婚”。';
 expect(reviewExtractedEvents(source,events).reasons).toContain('unsupported-quotation');
});

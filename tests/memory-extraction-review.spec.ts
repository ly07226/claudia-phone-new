import {test,expect} from '@playwright/test';
import {reviewExtractedEvents} from '../src/memoryExtractionReview';
test('event extraction review accepts concise event and empty event set',()=>{
 expect(reviewExtractedEvents('她否认说过喜欢他','她否认曾表达喜欢，实际感情尚未确认。').accepted).toBe(true);
 expect(reviewExtractedEvents('普通寒暄','').accepted).toBe(true);
});
test('event extraction review rejects oversized or fabricated empty placeholder',()=>{
 expect(reviewExtractedEvents('原文','没有重要事件').reasons).toContain('empty-placeholder');
 expect(reviewExtractedEvents('原文',Array.from({length:6},(_,i)=>'事件'+i).join('\\n')).reasons).toContain('too-many-events');
 expect(reviewExtractedEvents('原文','x'.repeat(4010)).reasons).toContain('oversized-events');
});

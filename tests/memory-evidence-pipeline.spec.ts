import {test,expect} from '@playwright/test';
import {parseSummaryWithEvidence} from '../src/memorySummaryFormat';
import {selectSummaryCandidates} from '../src/memorySummaryQuality';
import type {SummaryFact} from '../src/memorySummaryTypes';

// This exercises the actual JSON -> evidence parser -> durable-memory selection path,
// not a handwritten stand-in for either implementation.
const input=JSON.stringify([[{role:'user',content:'我不接受别人随便碰我的东西，这是我一直以来的边界。'}],[{role:'assistant',content:'我知道了。'}]]);
const candidate=(content:string,quote='我不接受别人随便碰我的东西',turn=1):SummaryFact=>({
 type:'fact',kind:'long',content,
 quality:{category:'boundary',importance:'high',durability:'lasting',impact:'以后互动必须尊重用户明确的物品边界',evidence:[{turn,role:'user',quote}]}
});
test('real parser and quality filter accept a grounded boundary',()=>{
 const parsed=parseSummaryWithEvidence(JSON.stringify({memories:[candidate('用户不接受别人随便碰自己的东西。')]}));
 const selected=selectSummaryCandidates(parsed,input);
 expect(selected.accepted).toHaveLength(1);
 expect(selected.rejected).toHaveLength(0);
});
test('real parser and quality filter reject a fabricated source quote',()=>{
 const parsed=parseSummaryWithEvidence(JSON.stringify({memories:[candidate('用户不接受别人随便碰自己的东西。','我允许别人随便碰我的东西')]}));
 expect(selectSummaryCandidates(parsed,input).accepted).toHaveLength(0);
});
test('real parser and quality filter reject wrong speaker or turn',()=>{
 const parsed=parseSummaryWithEvidence(JSON.stringify({memories:[candidate('用户不接受别人随便碰自己的东西。','我不接受别人随便碰我的东西',2)]}));
 expect(selectSummaryCandidates(parsed,input).accepted).toHaveLength(0);
});
test('empty candidate list is valid, not a fabricated memory',()=>{
 const parsed=parseSummaryWithEvidence('{"memories":[]}');
 expect(parsed).toHaveLength(0);
 expect(selectSummaryCandidates(parsed,input).accepted).toHaveLength(0);
});

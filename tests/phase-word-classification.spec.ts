import {test,expect} from '@playwright/test';
import {parsePhaseInstructionText} from '../src/phasePlay/wordInstructionImport';
test('unlabelled instructions default to green',()=>{
 const items=parsePhaseInstructionText('第一条指令\n第二条指令');
 expect(items.map(x=>x.phase)).toEqual(['green','green']);
});
test('colon phase headings group all following lines until the next heading',()=>{
 const items=parsePhaseInstructionText('红灯：\n第一条\n第二条\n绿灯：\n第三条\n黄灯:\n第四条');
 expect(items.map(x=>x.phase)).toEqual(['red','red','green','yellow']);
});
test('bracketed headings work and content is not guessed from keywords',()=>{
 const items=parsePhaseInstructionText('【红灯】\n继续动作\n【黄灯】\n暂停动作');
 expect(items.map(x=>x.phase)).toEqual(['red','yellow']);
});

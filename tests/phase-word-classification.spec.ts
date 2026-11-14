import {test,expect} from '@playwright/test';
import {classifyInstruction,parsePhaseInstructionText} from '../src/phasePlay/wordInstructionImport';
test('Word instructions are not silently assigned to green',()=>{
 const items=parsePhaseInstructionText('1. 暂停动作，保持不动。\n2. 放慢节奏。\n3. 加快节奏。\n4. 想一想接下来做什么。');
 expect(items.map(x=>x.phase)).toEqual(['red','yellow','green','unclassified']);
});
test('Word headings take priority over heuristic and preserve grouping',()=>{
 const items=parsePhaseInstructionText('【红灯】\n1. 停止动作。\n【黄灯】\n2. 放慢节奏。\n【绿灯】\n3. 保持稳定节奏。');
 expect(items.map(x=>x.phase)).toEqual(['red','yellow','green']);
});
test('mixed signals require manual classification',()=>{
 expect(classifyInstruction('先暂停再加快')).toBe('unclassified');
});

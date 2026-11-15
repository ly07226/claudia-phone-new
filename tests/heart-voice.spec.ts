import {test,expect} from '@playwright/test';
import {parseHeartVoice} from '../src/chatService';
import {readFileSync} from 'node:fs';

test('heart voice is separated from dialogue in one model response',()=>{
 const reply=parseHeartVoice('瞎说什么呢。\\n什么地尽头。\\n[心声]她怎么总爱胡思乱想。[/心声]');
 expect(reply.text).toBe('瞎说什么呢。\\n什么地尽头。');
 expect(reply.heartVoice).toBe('她怎么总爱胡思乱想。');
});
test('truncated metadata never leaks into visible dialogue',()=>{\n expect(parseHeartVoice('有哥哥在。[心声]不能丢给用户的残片').text).toBe('有哥哥在。');\n});\ntest('ordinary replies without heart metadata are unchanged',()=>{
 expect(parseHeartVoice('有哥哥在。')).toEqual({text:'有哥哥在。',heartVoice:undefined});
});
test('heart voice is only mounted after the first bubble',()=>{
 const source=readFileSync('src/MessageUI.tsx','utf8');
 expect(source).toContain('fragmentIndex===0 && heartVoice && heartOpen');
 expect(source).toContain('className="chat-heart-trigger"');
 expect(source).not.toContain('好感度');
 expect(source).not.toContain('占有欲');
});

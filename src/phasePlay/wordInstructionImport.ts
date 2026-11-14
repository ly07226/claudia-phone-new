import {readWizardDocument} from '../wizardDocumentImport';
import {normalizedInstruction} from './library';
import type {Phase} from './engine';

export interface ImportedPhaseInstruction {phase:Phase|'all';text:string}
const heading=/^(?:【|\[|#\s*)?(红灯|黄灯|绿灯|红色|黄色|绿色|red|yellow|green)(?:指令|阶段|模式|灯)?(?:】|\])?\s*[:：]?\s*$/i;
const color:Record<string,Phase>={红灯:'red',红色:'red',red:'red',黄灯:'yellow',黄色:'yellow',yellow:'yellow',绿灯:'green',绿色:'green',green:'green'};
/** Parse Word paragraphs locally. Unlabelled lines use the user's chosen phase, never guessed by AI. */
export function parsePhaseInstructionText(body:string,fallback:Phase|'all'):ImportedPhaseInstruction[]{
 let phase:Phase|'all'=fallback;
 const items:ImportedPhaseInstruction[]=[];
 const seen=new Set<string>();
 for(const raw of body.split(/\r?\n/)){
  const line=raw.trim();
  if(!line)continue;
  const title=line.match(heading);
  if(title){phase=color[title[1]]??color[title[1].toLowerCase()];continue;}
  const text=line.replace(/^\s*(?:[-*•]|\d{1,4}[.、．)）])\s*/u,'').trim();
  if(!text||text.length>1000)throw Error('文档存在空指令或超过1000字的段落，请修改后重新上传。');
  const key=normalizedInstruction(text);
  if(seen.has(key))continue;
  seen.add(key);
  items.push({phase,text});
  if(items.length>1000)throw Error('单次最多导入1000条指令，请拆分文档。');
 }
 if(!items.length)throw Error('Word 文档中没有识别到可用的文字指令。');
 return items;
}
export async function readPhaseInstructionWord(file:File,fallback:Phase|'all'){
 if(!/\.docx$/i.test(file.name))throw Error('请上传 .docx 格式的 Word 文件；旧版 .doc 请先另存为 .docx。');
 const parsed=await readWizardDocument(file);
 return parsePhaseInstructionText(parsed.longBody??'',fallback);
}

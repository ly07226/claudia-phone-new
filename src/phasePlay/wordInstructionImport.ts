import {readWizardDocument} from '../wizardDocumentImport';
import {normalizedInstruction} from './library';
import type {Phase} from './engine';

export interface ImportedPhaseInstruction {phase:Phase;text:string}
const heading=/^\s*(?:【|\[|#+\s*)?(红灯|黄灯|绿灯|红色|黄色|绿色|red|yellow|green)(?:指令|阶段|模式|灯)?\s*(?:】|\])?\s*[:：]?\s*$/i;
const color:Record<string,Phase>={红灯:'red',红色:'red',red:'red',黄灯:'yellow',黄色:'yellow',yellow:'yellow',绿灯:'green',绿色:'green',green:'green'};
/** Conservative rule-based classification; ambiguous text requires review. */
export function classifyInstruction(text:string):Phase|'unclassified'{
 const red=/(?:停下|停止|暂停|不动|静止|休息|别动|不要动|保持不动|等待下一|停住|停在那里|禁止继续|不许继续)/u.test(text);
 const yellow=/(?:放慢|减慢|慢下来|慢速|缓慢|慢一点|慢慢|逐渐减速|轻一点|降低速度|降低节奏|减速|慢动作)/u.test(text);
 const green=/(?:加快|加速|快一点|快速|提速|提高速度|跟着节拍|保持节奏|继续动作|持续动作|稳定节奏)/u.test(text);
 if(Number(red)+Number(yellow)+Number(green)!==1)return 'unclassified';
 return red?'red':yellow?'yellow':'green';
}

export function parsePhaseInstructionText(body:string):ImportedPhaseInstruction[]{
 let phase:Phase='green';
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
export interface WordImportProgress {stage:'reading'|'classifying'|'done';processed:number;total:number}
export async function readPhaseInstructionWord(file:File,onProgress?:(progress:WordImportProgress)=>void){
 if(!/\.docx$/i.test(file.name))throw Error('请上传 .docx 格式的 Word 文件；旧版 .doc 请先另存为 .docx。');
 onProgress?.({stage:'reading',processed:0,total:0});
 const parsed=await readWizardDocument(file);
 const lines=(parsed.longBody??'').split(/\r?\n/);
 let phase:Phase|'unclassified'='unclassified';
 const items:ImportedPhaseInstruction[]=[],seen=new Set<string>();
 onProgress?.({stage:'classifying',processed:0,total:lines.length});
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();
  if(line){
   const title=line.match(heading);
   if(title)phase=color[title[1]]??color[title[1].toLowerCase()];
   else{
    const text=line.replace(/^\s*(?:[-*•]|\d{1,4}[.、．)）])\s*/u,'').trim();
    if(!text||text.length>1000)throw Error('文档存在空指令或超过1000字的段落，请修改后重新上传。');
    const key=normalizedInstruction(text);
    if(!seen.has(key)){seen.add(key);items.push({phase:phase==='unclassified'?classifyInstruction(text):phase,text});}
    if(items.length>1000)throw Error('单次最多导入1000条指令，请拆分文档。');
   }
  }
  if((i+1)%25===0||i===lines.length-1){
   onProgress?.({stage:'classifying',processed:i+1,total:lines.length});
   await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
 }
 if(!items.length)throw Error('Word 文档中没有识别到可用的文字指令。');
 onProgress?.({stage:'done',processed:lines.length,total:lines.length});
 return items;
}

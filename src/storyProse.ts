export interface StoryProsePart {kind:'narrative'|'dialogue'|'break';text:string}
const pairs:Record<string,string>={'“':'”','「':'」','‘':'’','『':'』'};
const closes=new Set(Object.values(pairs));
const nonSpeech=/心想|心中|心里|想道|暗想|默念|心理|自问|问自己|自忖|念头|引用|引文|写道|写着|书上|书中|文档|原文|示例|标语/;
const speech=/(?:说道|问道|答道|喊道|低声道|轻声道|开口道|笑道|回答|说|问|答|喊|低语)[：:，,]\s*$/;
/** Syntax-only display formatting. No rewriting, speaker guesses or persistent data. */
export function formatStoryProse(body:string):StoryProsePart[]{
 const parts:StoryProsePart[]=[];
 function narrative(text:string){
  if(!text)return;let start=0;const stack:string[]=[];let broken=false;
  for(let i=0;i<text.length;i++){
   const c=text[i];if(pairs[c])stack.push(pairs[c]);else if(closes.has(c)){if(stack.at(-1)===c)stack.pop();else broken=true;}
   if(!broken&&!stack.length&&i-start>=89&&/[。！？!?]/.test(c)){parts.push({kind:'narrative',text:text.slice(start,i+1)});start=i+1;}
  }
  if(start<text.length)parts.push({kind:'narrative',text:text.slice(start)});
 }
 let previous='';
 for(const [index,line] of body.split(/(\r\n|\r|\n)/).entries()){
  if(index%2){parts.push({kind:'break',text:line});continue;}
  if(!line){parts.push({kind:'narrative',text:''});continue;}
  const ranges:{start:number;end:number;unsafe:boolean}[]=[];let start=-1,unsafe=false,broken=false;const stack:string[]=[];
  for(let i=0;i<line.length;i++){
   const c=line[i];if(pairs[c]){if(!stack.length){start=i;unsafe=!['“','「'].includes(c);}else unsafe=true;stack.push(pairs[c]);}
   else if(closes.has(c)){if(stack.at(-1)!==c){broken=true;continue;}stack.pop();if(!stack.length)ranges.push({start,end:i+1,unsafe});}
   else if(c==='"'&&stack.length)unsafe=true;
  }
  // Unbalanced or mixed quotes are ordinary prose, never partly labelled as dialogue.
  if(stack.length||broken){narrative(line);if(line.trim())previous=line;continue;}
  let cursor=0;
  for(const q of ranges){
   if(q.unsafe)continue;const before=line.slice(0,q.start),after=line.slice(q.end),quoted=line.slice(q.start,q.end),clause=before.split(/[。！？!?]/).at(-1)??'';
   const standalone=!before.trim()&&!after.trim()&&/[。！？!?…][”」]$/.test(quoted)&&/[你我您咱？?!！]/.test(quoted);
   const following=/^[，,]?\s*(?:他|她|我|你|您)(?:说道|问道|答道|说|问|回答)[。！]?/.test(after)&&!nonSpeech.test(after.slice(0,80));
   if(nonSpeech.test(clause)||standalone&&nonSpeech.test(previous.slice(-80))||!(speech.test(clause)||standalone||following))continue;
   narrative(line.slice(cursor,q.start));parts.push({kind:'dialogue',text:quoted});cursor=q.end;
  }
  narrative(line.slice(cursor));if(line.trim())previous=line;
 }
 return parts.map(p=>p.text).join('')===body?parts:[{kind:'narrative',text:body}];
}

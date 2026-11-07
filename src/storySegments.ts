import type {StorySegment} from './storyTypes';
/** Match only whitespace differences, then render exact slices of the saved body. */
export function resolveStorySegments(body:string,value:unknown,knownSpeakers?:readonly string[]):StorySegment[]|undefined {
 if(!Array.isArray(value)||!value.length||value.length>256)return;
 const normalized=(s:string)=>s.replace(/\s/gu,'');
 const segments:StorySegment[]=[];let cursor=0;
 for(const item of value){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['type','text','speaker'].includes(k))||!['narration','action','dialogue'].includes(item.type)||typeof item.text!=='string'||!normalized(item.text))return;
  if(item.type==='dialogue'){
   if(typeof item.speaker!=='string'||!item.speaker.trim()||item.speaker.length>80||/[\r\n\u0000-\u001f]/.test(item.speaker))return;
   if(knownSpeakers&&!knownSpeakers.includes(item.speaker.trim())&&!body.includes(item.speaker.trim()))return;
  }else if(item.speaker!==undefined)return;
  const wanted=normalized(item.text);let matched='';const start=cursor;
  while(cursor<body.length&&matched.length<wanted.length){const c=body[cursor++];if(!/\s/u.test(c))matched+=c;}
  if(matched!==wanted)return;
  while(cursor<body.length&&/\s/u.test(body[cursor]))cursor++;
  segments.push({type:item.type,text:body.slice(start,cursor),...(item.type==='dialogue'?{speaker:item.speaker.trim()}:{})} as StorySegment);
 }
 if(normalized(body.slice(cursor)))return;
 segments[segments.length-1].text+=body.slice(cursor);
 return segments;
}

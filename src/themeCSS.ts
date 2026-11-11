import {validateStoryReading} from './storyReadingPreferences';
import {validatePalette} from './themePalette';
/** A small CSS grammar, not arbitrary CSS. Output contains only fixed selectors,
 * enumerated properties and canonical colors/bounded numbers. No raw selector/value is emitted. */
const targets:Record<string,string[]>={'.theme-page':['&'],'.theme-card':['.card','.story-reading-card','.memory-card','.lore-book-card','.lore-entry-card','.space-card'],'.theme-button':['.primary'],'.theme-user-bubble':['.chat-user .chat-bubble-surface'],'.theme-role-bubble':['.chat-assistant .chat-bubble-surface'],'.chat-user':['.chat-user .chat-bubble-surface'],'.chat-assistant':['.chat-assistant .chat-bubble-surface'],'.chat-bubble':['.chat-bubble-surface'],'.chat-bubble-surface':['.chat-bubble-surface'],'.theme-dialogue':['.story-dialogue'],'.theme-action':['.story-action-description'],'.theme-speaker':['.story-speaker']};
const colorProperties=new Set(['color','background-color','border-color','outline-color']);
const ranges:Record<string,{min:number;max:number;unit:string}>={'border-radius':{min:0,max:28,unit:'px'},'font-size':{min:12,max:24,unit:'px'},'line-height':{min:1.2,max:2,unit:''}};
const bubbleSelectors=new Set(['.theme-user-bubble','.theme-role-bubble','.chat-user','.chat-assistant','.chat-bubble','.chat-bubble-surface']);
const bubbleProperties=new Set(['background','background-image','box-shadow','border','border-width','border-style','padding','letter-spacing','font-weight','font-style','text-align','opacity','text-shadow']);
const safeBubbleValue=(property:string,value:string):boolean=>{
 if(value.length>240||/[{};<>\\]/.test(value)||/url\s*\(|@import|expression\s*\(|var\s*\(|!important|position|calc\s*\(/i.test(value))return false;
 if(property==='background'||property==='background-image')return /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|linear-gradient\([#\w\d\s.,%()\-]+\)|none)$/i.test(value);
 if(property==='box-shadow'||property==='text-shadow')return /^(?:none|[\d\s.,#%a-z()\-]+)$/i.test(value)&&!/[a-z]+\s*\(/i.test(value.replace(/rgba?\([\d\s.,%]+\)/gi,''));
 if(property==='border')return /^(?:none|(?:\d{1,2}px\s+)?(?:solid|dashed|dotted)\s+(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)))$/i.test(value);
 if(property==='border-width'||property==='padding'||property==='letter-spacing')return /^(?:\d{1,2}(?:\.\d+)?px)(?:\s+\d{1,2}(?:\.\d+)?px){0,3}$/.test(value);
 if(property==='border-style')return /^(none|solid|dashed|dotted)$/.test(value);
 if(property==='font-weight')return /^(normal|bold|[1-9]00)$/.test(value);
 if(property==='font-style')return /^(normal|italic)$/.test(value);
 if(property==='text-align')return /^(left|right|center|start|end)$/.test(value);
 if(property==='opacity')return /^0(?:\.\d+)?$|^1(?:\.0+)?$/.test(value);
 return false;
};
const invalid=():never=>{throw Error('CSS 校验未通过：请检查选择器、属性或属性值。气泡支持 12～24px 字号、颜色、边框、阴影及内边距；不支持外部资源、嵌套规则或页面布局控制。');};
export function compileThemeCSS(source:string,preview=false):string{
 if(typeof source!=='string'||source.length>8000)throw Error('自定义 CSS 最多 8000 字符。');
 let i=0;const rules:string[]=[];let hasBubbleRule=false;
 const skip=()=>{while(i<source.length){if(/\s/.test(source[i])){i++;continue;}if(source.slice(i,i+2)==='/*'){const end=source.indexOf('*/',i+2);if(end<0)invalid();i=end+2;continue;}break;}};
 const token=(regex:RegExp)=>{skip();regex.lastIndex=i;const m=regex.exec(source);if(!m)invalid();i=regex.lastIndex;return m![0];};
 const mark=(ch:string)=>{skip();if(source[i]!==ch)invalid();i++;};
 const scope=preview?'.phone[data-theme-editing="true"] .theme-editor [data-theme-preview]':'.phone.phone[data-theme-editing="false"]';
 skip();while(i<source.length){
  const selectors:string[]=[];
  do{const selector=token(/\.[a-z][a-z-]*/y);if(!Object.hasOwn(targets,selector))invalid();selectors.push(...targets[selector]);skip();if(source[i]!==',')break;i++;}while(true);
  mark('{');const declarations:string[]=[];skip();const isBubble=selectors.every(s=>s.includes('chat-bubble-surface'));if(isBubble)hasBubbleRule=true;
  while(source[i]!=='}'){
   const property=token(/[a-z][a-z-]*/y);mark(':');let value:string;
   if(colorProperties.has(property)){const start=i;skip();const end=source.indexOf(';',i),close=source.indexOf('}',i);const stop=end>=0&&end<close?end:close;const candidate=source.slice(i,stop).trim();if(isBubble&&/^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(candidate)){value=candidate;i=stop;}else{i=start;value=token(/#[0-9a-fA-F]{6}(?![0-9a-fA-F])/y).toUpperCase();}}
   else if(Object.hasOwn(ranges,property)){const rule=ranges[property],number=token(/(?:\d+(?:\.\d+)?)/y);const n=Number(number);if(n<rule.min||n>rule.max)invalid();if(rule.unit){mark('p');mark('x');}value=String(n)+rule.unit;}
   else if(isBubble&&bubbleProperties.has(property)){skip();const end=source.indexOf(';',i),close=source.indexOf('}',i);const stop=end>=0&&end<close?end:close;if(stop<0)invalid();value=source.slice(i,stop).trim();if(!safeBubbleValue(property,value))invalid();i=stop;}
   else invalid();
   declarations.push(`${property}:${value!}`);skip();if(source[i]===';'){i++;skip();}else if(source[i]!=='}')invalid();
   if(declarations.length>24)invalid();
  }
  mark('}');if(!declarations.length)invalid();
  rules.push(`${selectors.map(s=>s==='&'?scope:`${scope} ${s}`).join(',')}{${declarations.join(';')}}`);if(rules.length>40)invalid();skip();
 }
 if(hasBubbleRule){rules.unshift(`${scope} .chat-bubble.chat-user:has(> .chat-bubble-surface),${scope} .chat-bubble.chat-assistant:has(> .chat-bubble-surface){background:transparent!important;background-image:none!important;border:0!important;box-shadow:none!important;padding:0!important}`);}
 return rules.join('\n');
}
export function validateThemeAppearance(value:unknown){
 const x=value as {storyReading?:unknown;palette?:unknown;customCss?:{version:number;source:string}};
 if(x?.storyReading!==undefined)validateStoryReading(x.storyReading);
 if(x?.palette!==undefined)validatePalette(x.palette);
 if(x?.customCss!==undefined){const c=x.customCss;if(!c||typeof c!=='object'||Array.isArray(c)||c.version!==1||Object.keys(c).some(k=>!['version','source'].includes(k)))throw Error('自定义 CSS 格式无效。');compileThemeCSS(c.source);}
}

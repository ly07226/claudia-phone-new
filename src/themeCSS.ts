import {validateStoryReading} from './storyReadingPreferences';
import {validatePalette} from './themePalette';
/** A small CSS grammar, not arbitrary CSS. Output contains only fixed selectors,
 * enumerated properties and canonical colors/bounded numbers. No raw selector/value is emitted. */
const targets:Record<string,string[]>={'.theme-page':['&'],'.theme-card':['.card','.story-reading-card','.memory-card','.lore-book-card','.lore-entry-card','.space-card'],'.theme-button':['.primary'],'.theme-user-bubble':['.chat-user .chat-bubble-surface'],'.theme-role-bubble':['.chat-assistant .chat-bubble-surface'],'.chat-user':['.chat-user .chat-bubble-surface'],'.chat-assistant':['.chat-assistant .chat-bubble-surface'],'.chat-bubble':['.chat-bubble-surface'],'.chat-bubble-surface':['.chat-bubble-surface'],'.theme-dialogue':['.story-dialogue'],'.theme-action':['.story-action-description'],'.theme-speaker':['.story-speaker']};
const colorProperties=new Set(['color','background-color','border-color','outline-color']);
const ranges:Record<string,{min:number;max:number;unit:string}>={'border-radius':{min:0,max:28,unit:'px'},'font-size':{min:12,max:24,unit:'px'},'line-height':{min:1.2,max:2,unit:''}};
export function normalizeBubbleCSS(source:string):string{
 return source
 .replace(/\.message-container\.(?:sent|user)\s+\.message-bubble/g,'.theme-user-bubble')
 .replace(/\.message-container\.(?:received|assistant)\s+\.message-bubble/g,'.theme-role-bubble')
 .replace(/\.message-bubble:hover::before/g,'.theme-user-bubble:hover::before')
 .replace(/\.message-bubble:hover::after/g,'.theme-role-bubble:hover::after')
 .replace(/\.message-bubble:active/g,'.theme-user-bubble:active, .theme-role-bubble:active')
 .replace(/\.message-container\.(?:sent|user)/g,'.theme-user-row')
 .replace(/\.message-container\.(?:received|assistant)/g,'.theme-role-row')
 .replace(/\.message-container/g,'.theme-message-row')
 .replace(/^[^\n{}]*无边框版[^\n{}]*$/gm,'');
}
const effectSelectors:Record<string,string[]>={
 '.theme-user-row':['.chat-message-row-user'],'.theme-role-row':['.chat-message-row-assistant'],'.theme-message-row':['.chat-message-row'],
 '.theme-user-bubble::before':['.chat-user .chat-bubble-surface::before'],
 '.theme-role-bubble::after':['.chat-assistant .chat-bubble-surface::after'],
 '.theme-user-bubble:active':['.chat-user .chat-bubble-surface:active'],
 '.theme-role-bubble:active':['.chat-assistant .chat-bubble-surface:active'],
 '.theme-user-bubble:hover::before':['.chat-user .chat-bubble-surface:hover::before'],
 '.theme-role-bubble:hover::after':['.chat-assistant .chat-bubble-surface:hover::after']
};
const safeStickerUrl=(v:string)=>{const m=/^url\(["']?(https:\/\/[^"'()\s]+)["']?\)$/.exec(v);if(!m)return false;try{const u=new URL(m[1]);return u.protocol==='https:'&&u.hostname.length<150&&/\.(png|webp|gif|jpg|jpeg)$/i.test(u.pathname)&&!u.username&&!u.password;}catch{return false;}};
const safeEffect=(p:string,v:string,sticker:boolean)=>{
 if(p==='content')return sticker&&v==='""';
 if(p==='margin-bottom')return /^(?:[0-9]|1[0-9]|20)px$/.test(v);
 if(p==='display')return v==='flex';
 if(p==='justify-content')return v==='flex-start'||v==='flex-end';
 if(p==='animation')return v==='jellyIn 0.4s ease-out forwards';
 if(p==='background-image')return sticker&&safeStickerUrl(v);
 if(p==='position')return sticker&&v==='absolute';
 if(['top','left','right','bottom'].includes(p))return /^-?(?:[0-9]|[12][0-9])px$/.test(v);
 if(['width','height'].includes(p))return /^(?:[1-9]|[1-5][0-9]|60)px$/.test(v);
 if(['background-size','background-repeat','background-position'].includes(p))return ['contain','no-repeat','center'].includes(v);
 if(p==='opacity')return /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(v);
 if(p==='z-index')return v==='1';
 if(p==='transform')return /^rotate\(-?(?:[0-9]|1[0-5])deg\)$/.test(v)||v==='rotate(0deg) scale(1.15)'||v==='scale(0.98)';
 if(p==='filter')return /^drop-shadow\(0 [23]px [36]px rgba\([\d\s.,]+\)\)$/.test(v);
 if(p==='transition')return /^all 0\.3s cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)$/.test(v);
 if(p==='box-shadow')return safeBubbleValue(p,v);
 return false;
};
const bubbleSelectors=new Set(['.theme-user-bubble','.theme-role-bubble','.chat-user','.chat-assistant','.chat-bubble','.chat-bubble-surface']);
const bubbleProperties=new Set(['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius','font-family','max-width','position','transition','animation','transform','margin-bottom','display','justify-content','padding-top','background','background-image','box-shadow','border','border-width','border-style','padding','letter-spacing','font-weight','font-style','text-align','opacity','text-shadow','backdrop-filter','-webkit-backdrop-filter']);
const safeBubbleValue=(property:string,value:string):boolean=>{
 if(value.length>240||/[{};<>\\]/.test(value)||/url\s*\(|@import|expression\s*\(|var\s*\(|position|calc\s*\(/i.test(value))return false;
 if(property.startsWith('border-')&&property.endsWith('-radius'))return /^(?:\d{1,2}(?:\.\d+)?px)(?:\s+\d{1,2}(?:\.\d+)?px)?$/.test(value);
 if(property==='font-family')return /^['"\w ,\-]+$/.test(value)&&value.length<120;
 if(property==='position')return value==='relative';
 if(property==='max-width')return /^(?:[1-9]\d?|100)%$/.test(value);
 if(property==='margin-bottom'||property==='padding-top')return /^(?:[0-9]|[1-2][0-9])px$/.test(value);
 if(property==='display')return value==='flex';
 if(property==='justify-content')return /^(flex-start|flex-end)$/.test(value);
 if(property==='transition')return /^all 0\.3s cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)$/.test(value);
 if(property==='transform')return /^scale\(0\.98\)$/.test(value);
 if(property==='animation')return value==='jellyIn 0.4s ease-out forwards';
 if(property==='backdrop-filter'||property==='-webkit-backdrop-filter')return /^blur\((?:0|[1-9]|1[0-9]|20)(?:\.\d+)?px\)$/.test(value)&&Number(value.slice(5,-3))<=20;
 if(property==='background'||property==='background-image')return /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|linear-gradient\([#\w\d\s.,%()\-]+\)|none)$/i.test(value);
 if(property==='box-shadow'||property==='text-shadow'){const v=value.replace(/\s*!important\s*$/i,'').trim();return /^(?:none|[\d\s.,#%a-z()\-]+)$/i.test(v)&&!/[a-z]+\s*\(/i.test(v.replace(/rgba?\([\d\s.,%]+\)/gi,''));}
 if(property==='border')return /^(?:none|(?:\d{1,2}(?:\.\d+)?px\s+)?(?:solid|dashed|dotted)\s+(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)))$/i.test(value);
 if(property==='border-width'||property==='padding'||property==='letter-spacing')return /^(?:\d{1,2}(?:\.\d+)?px)(?:\s+\d{1,2}(?:\.\d+)?px){0,3}$/.test(value);
 if(property==='border-style')return /^(none|solid|dashed|dotted)$/.test(value);
 if(property==='font-weight')return /^(normal|bold|[1-9]00)$/.test(value);
 if(property==='font-style')return /^(normal|italic)$/.test(value);
 if(property==='text-align')return /^(left|right|center|start|end)$/.test(value);
 if(property==='opacity')return /^0(?:\.\d+)?$|^1(?:\.0+)?$/.test(value);
 return false;
};
const invalid=():never=>{throw Error('CSS 校验未通过：请检查选择器、属性或属性值。气泡支持 12～24px 字号、颜色、边框、阴影、内边距及 blur(0～20px) 毛玻璃；不支持外部资源、嵌套规则或页面布局控制。');};
export function compileThemeCSS(source:string,preview=false):string{
 if(typeof source!=='string'||source.length>24000)throw Error('自定义 CSS 最多 24000 字符。');
 const hasJelly=/@keyframes\s+jellyIn\s*\{/.test(source);
 source=source.replace(/@keyframes\s+jellyIn\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(8px\) scale\(0\.95\);\s*\}\s*to\s*\{\s*opacity:\s*1;\s*transform:\s*translateY\(0\) scale\(1\);\s*\}\s*\}/g,'');
 source=normalizeBubbleCSS(source).replace(/^[^{}\n]*无边框版[^{}\n]*$/gm,'').replace(/\s*!important\s*(?=;|})/gi,'');
 let i=0;const rules:string[]=[];let hasBubbleRule=false;
 const invalid=():never=>{const line=source.slice(0,i).split('\n').length;const excerpt=source.slice(Math.max(0,i-20),Math.min(source.length,i+55)).replace(/\s+/g,' ').trim();throw Error(`CSS 第 ${line} 行附近不受支持：${excerpt||'(空内容)'}。请检查选择器、属性和值。`);};
 const skip=()=>{while(i<source.length){if(/\s/.test(source[i])){i++;continue;}if(source.slice(i,i+2)==='/*'){const end=source.indexOf('*/',i+2);if(end<0)invalid();i=end+2;continue;}break;}};
 const token=(regex:RegExp)=>{skip();regex.lastIndex=i;const m=regex.exec(source);if(!m)invalid();i=regex.lastIndex;return m![0];};
 const mark=(ch:string)=>{skip();if(source[i]!==ch)invalid();i++;};
 const scope=preview?'.phone[data-theme-editing="true"] .theme-editor [data-theme-preview]':'.phone.phone[data-theme-editing="false"]';
 skip();while(i<source.length){
  const selectors:string[]=[];let effect=false,sticker=false;
  do{const selector=token(/\.[a-z][a-z-]*(?::hover::before|:hover::after|::before|::after|:active)?/y);if(Object.hasOwn(effectSelectors,selector)){effect=true;if(selector.includes('::'))sticker=true;selectors.push(...effectSelectors[selector]);}else if(Object.hasOwn(targets,selector)){selectors.push(...targets[selector]);}else invalid();skip();if(source[i]!==',')break;i++;}while(true);
  mark('{');const declarations:string[]=[];skip();const isBubble=selectors.every(s=>s.includes('chat-bubble-surface'));if(isBubble)hasBubbleRule=true;
  while(source[i]!=='}'){
   const property=token(/-?[a-z][a-z-]*/y);mark(':');let value:string;
   if(colorProperties.has(property)){const start=i;skip();const end=source.indexOf(';',i),close=source.indexOf('}',i);const stop=end>=0&&end<close?end:close;const candidate=source.slice(i,stop).trim().replace(/\s*!important\s*$/i,'');if(isBubble&&/^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(candidate)){value=candidate;i=stop;}else if(/^#[0-9a-fA-F]{6}$/.test(candidate)){value=candidate.toUpperCase();i=stop;}else{i=start;value=token(/#[0-9a-fA-F]{6}(?![0-9a-fA-F])/y).toUpperCase();}}
   else if(Object.hasOwn(ranges,property)){const rule=ranges[property],number=token(/(?:\d+(?:\.\d+)?)/y);const n=Number(number);if(n<rule.min||n>rule.max)invalid();if(rule.unit){mark('p');mark('x');}value=String(n)+rule.unit;}
   else if(effect){skip();const end=source.indexOf(';',i),close=source.indexOf('}',i);const stop=end>=0&&end<close?end:close;if(stop<0)invalid();value=source.slice(i,stop).trim();if(!safeEffect(property,value,sticker))invalid();i=stop;}
   else if(isBubble&&bubbleProperties.has(property)){skip();const end=source.indexOf(';',i),close=source.indexOf('}',i);const stop=end>=0&&end<close?end:close;if(stop<0)invalid();value=source.slice(i,stop).trim();if(!safeBubbleValue(property,value))invalid();value=value.replace(/\s*!important\s*$/i,'');i=stop;}
   else invalid();
   declarations.push(`${property}:${value!}`);skip();if(source[i]===';'){i++;skip();}else if(source[i]!=='}')invalid();
   if(declarations.length>48)invalid();
  }
  mark('}');if(!declarations.length)invalid();
  rules.push(`${selectors.map(s=>s==='&'?scope:`${scope} ${s}`).join(',')}{${declarations.join(';')}}`);if(rules.length>60)invalid();skip();
 }
 if(hasBubbleRule){rules.unshift(`${scope} .chat-bubble-surface{position:relative;overflow:visible}`);}
 if(hasBubbleRule){rules.unshift(`${scope} .chat-bubble.chat-user:has(> .chat-bubble-surface),${scope} .chat-bubble.chat-assistant:has(> .chat-bubble-surface){background:transparent!important;background-image:none!important;border:0!important;box-shadow:none!important;padding:0!important}`);}
 if(hasJelly){rules.unshift('@keyframes jellyIn{from{opacity:0;transform:translateY(8px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}}');}
 return rules.join('\n');
}
export function validateThemeAppearance(value:unknown){
 const x=value as {storyReading?:unknown;palette?:unknown;customCss?:{version:number;source:string}};
 if(x?.storyReading!==undefined)validateStoryReading(x.storyReading);
 if(x?.palette!==undefined)validatePalette(x.palette);
 if(x?.customCss!==undefined){const c=x.customCss;if(!c||typeof c!=='object'||Array.isArray(c)||c.version!==1||Object.keys(c).some(k=>!['version','source'].includes(k)))throw Error('自定义 CSS 格式无效。');compileThemeCSS(c.source);}
}

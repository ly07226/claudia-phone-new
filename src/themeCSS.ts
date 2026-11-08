import {validatePalette} from './themePalette';
/** A small CSS grammar, not arbitrary CSS. Output contains only fixed selectors,
 * enumerated properties and canonical colors/bounded numbers. No raw selector/value is emitted. */
const targets:Record<string,string[]>={'.theme-page':['&'],'.theme-card':['.card','.story-reading-card','.memory-card','.lore-book-card','.lore-entry-card','.space-card'],'.theme-button':['.primary'],'.theme-user-bubble':['.chat-user .chat-bubble-surface'],'.theme-role-bubble':['.chat-assistant .chat-bubble-surface'],'.theme-dialogue':['.story-dialogue'],'.theme-action':['.story-action-description'],'.theme-speaker':['.story-speaker']};
const colorProperties=new Set(['color','background-color','border-color','outline-color']);
const ranges:Record<string,{min:number;max:number;unit:string}>={'border-radius':{min:0,max:28,unit:'px'},'font-size':{min:16,max:20,unit:'px'},'line-height':{min:1.2,max:2,unit:''}};
const invalid=():never=>{throw Error('CSS 不符合受限规则：仅支持列出的选择器、HEX 颜色和规定范围的数值；不支持外部资源、嵌套规则或布局控制。');};
export function compileThemeCSS(source:string,preview=false):string{
 if(typeof source!=='string'||source.length>8000)throw Error('自定义 CSS 最多 8000 字符。');
 let i=0;const rules:string[]=[];
 const skip=()=>{while(i<source.length){if(/\s/.test(source[i])){i++;continue;}if(source.slice(i,i+2)==='/*'){const end=source.indexOf('*/',i+2);if(end<0)invalid();i=end+2;continue;}break;}};
 const token=(regex:RegExp)=>{skip();regex.lastIndex=i;const m=regex.exec(source);if(!m)invalid();i=regex.lastIndex;return m![0];};
 const mark=(ch:string)=>{skip();if(source[i]!==ch)invalid();i++;};
 const scope=preview?'.phone[data-theme-editing="true"] .theme-editor [data-theme-preview]':'.phone.phone[data-theme-editing="false"]';
 skip();while(i<source.length){
  const selectors:string[]=[];
  do{const selector=token(/\.[a-z][a-z-]*/y);if(!Object.hasOwn(targets,selector))invalid();selectors.push(...targets[selector]);skip();if(source[i]!==',')break;i++;}while(true);
  mark('{');const declarations:string[]=[];skip();
  while(source[i]!=='}'){
   const property=token(/[a-z][a-z-]*/y);mark(':');let value:string;
   if(colorProperties.has(property)){value=token(/#[0-9a-fA-F]{6}(?![0-9a-fA-F])/y).toUpperCase();}
   else if(Object.hasOwn(ranges,property)){const rule=ranges[property],number=token(/(?:\d+(?:\.\d+)?)/y);const n=Number(number);if(n<rule.min||n>rule.max)invalid();if(rule.unit){mark('p');mark('x');}value=String(n)+rule.unit;}
   else invalid();
   declarations.push(`${property}:${value!}`);skip();if(source[i]===';'){i++;skip();}else if(source[i]!=='}')invalid();
   if(declarations.length>24)invalid();
  }
  mark('}');if(!declarations.length)invalid();
  rules.push(`${selectors.map(s=>s==='&'?scope:`${scope} ${s}`).join(',')}{${declarations.join(';')}}`);if(rules.length>40)invalid();skip();
 }
 return rules.join('\n');
}
export function validateThemeAppearance(value:unknown){
 const x=value as {palette?:unknown;customCss?:{version:number;source:string}};
 if(x?.palette!==undefined)validatePalette(x.palette);
 if(x?.customCss!==undefined){const c=x.customCss;if(!c||typeof c!=='object'||Array.isArray(c)||c.version!==1||Object.keys(c).some(k=>!['version','source'].includes(k)))throw Error('自定义 CSS 格式无效。');compileThemeCSS(c.source);}
}

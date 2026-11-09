import type {CSSProperties} from 'react';
export interface StoryReadingPreferences {version:1;fontSize:number;lineHeight:number;margin:number;color?:string;background?:string;opacity:number}
export const defaultStoryReading:StoryReadingPreferences={version:1,fontSize:17,lineHeight:1.65,margin:32,opacity:50};
export const storyReadingColors=[{name:'深灰',value:'#333333'},{name:'纯黑',value:'#000000'},{name:'棕褐',value:'#6B4F3A'},{name:'雾蓝',value:'#536B80'}];
export function validateStoryReading(value:unknown):asserts value is StoryReadingPreferences {
 const p=value as StoryReadingPreferences;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['version','fontSize','lineHeight','margin','color','background','opacity'].includes(k))||p.version!==1||!Number.isInteger(p.fontSize)||p.fontSize<13||p.fontSize>26||!Number.isFinite(p.lineHeight)||p.lineHeight<1.2||p.lineHeight>2.5||p.lineHeight!==1.65&&Math.abs(p.lineHeight*10-Math.round(p.lineHeight*10))>0.00001||!Number.isInteger(p.margin)||p.margin<8||p.margin>40||p.margin%2!==0||!Number.isInteger(p.opacity)||p.opacity<0||p.opacity>100||p.opacity%5!==0||p.color!==undefined&&!/^#[a-f\d]{6}$/i.test(p.color)||p.background!==undefined&&(typeof p.background!=='string'||p.background.length>2100000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z\d+/]+={0,2}$/.test(p.background)))throw Error('阅读外观设置无效，未保存。');
}
export function storedStoryReading(value:unknown):StoryReadingPreferences {try{validateStoryReading(value);return value;}catch{return {...defaultStoryReading};}}
export function storyReadingStyle(p:StoryReadingPreferences):CSSProperties {return {'--reader-font':`${p.fontSize}px`,'--reader-line':p.lineHeight,'--reader-margin':`${p.margin}px`,'--reader-color':p.color,'--reader-image':p.background?`url("${p.background}")`:'none','--reader-opacity':p.opacity/100} as CSSProperties;}

export const colorLabels={page:'页面背景',card:'卡片背景',input:'输入框背景',text:'正文文字',muted:'次要文字',border:'边框',accent:'强调色',button:'按钮背景',buttonText:'按钮文字',userBubble:'用户气泡背景',userBubbleText:'用户气泡文字',assistantBubble:'角色气泡背景',assistantBubbleText:'角色气泡文字',dialogue:'剧本对话背景',dialogueText:'剧本对话文字',speaker:'人物署名',action:'动作描写',danger:'危险操作',focus:'焦点提示'} as const;
export type ThemeColor=keyof typeof colorLabels;
export type ThemeColors=Record<ThemeColor,string>;
export type PresetId='white'|'midnight'|'sage'|'pink'|'blue'|'purple'|'caramel';
export interface ThemePalette{version:1;presetId?:PresetId;colors:ThemeColors}
export interface ThemeCSS{version:1;source:string}
const light=(page:string,card:string,accent:string,muted:string,border:string,userBubble:string):ThemeColors=>({page,card,input:'#FFFFFF',text:'#303B35',muted,border,accent,button:accent,buttonText:'#FFFFFF',userBubble,userBubbleText:'#25352C',assistantBubble:card,assistantBubbleText:'#303B35',dialogue:userBubble,dialogueText:'#303B35',speaker:accent,action:muted,danger:'#A23F3B',focus:accent});
export const themePresets:readonly {id:PresetId;name:string;base:string;colors:ThemeColors}[]=[
 {id:'white',name:'经典白',base:'#F8F8F6',colors:{...light('#F5F5F2','#FFFFFD','#606863','#70766F','#D9DDD7','#E8EAE6'),input:'#FFFFFF',text:'#353A36',userBubbleText:'#353A36',assistantBubble:'#FAFBF8',assistantBubbleText:'#353A36',dialogue:'#EEF0EB',dialogueText:'#353A36'}},
 {id:'midnight',name:'午夜黑',base:'#22252B',colors:{page:'#1C1D20',card:'#282A2F',input:'#202226',text:'#F1F0ED',muted:'#B7B8BD',border:'#484B52',accent:'#C3C5CC',button:'#BDC0C7',buttonText:'#202226',userBubble:'#3D4047',userBubbleText:'#F1F0ED',assistantBubble:'#303239',assistantBubbleText:'#F1F0ED',dialogue:'#35373E',dialogueText:'#F1F0ED',speaker:'#CDD0D6',action:'#AEB0B8',danger:'#F0AAA4',focus:'#D3D6DD'}},
 {id:'sage',name:'鼠尾草绿',base:'#A8BBA5',colors:{...light('#EEF2EA','#FBFCF7','#526B4D','#667760','#CED8C7','#DFE9D9'),input:'#FFFFFF',assistantBubble:'#F4F7F0',dialogue:'#E6EEDD'}},
 {id:'pink',name:'樱花粉',base:'#EAB9C8',colors:{...light('#F6F2F0','#FFFDF9','#805866','#796A70','#DDD1D4','#EFE0E4'),input:'#FFFEFC',text:'#443C40',userBubbleText:'#443C40',assistantBubble:'#FAF5F3',assistantBubbleText:'#443C40',dialogue:'#F0E4E7',dialogueText:'#443C40',button:'#86616D'}},
 {id:'blue',name:'雾霾蓝',base:'#A4B9CD',colors:{...light('#F0F3F6','#FCFDFE','#526C82','#637583','#CCD6DF','#DFE7EE'),input:'#FFFFFF',text:'#344450',userBubbleText:'#344450',assistantBubble:'#F7F9FB',assistantBubbleText:'#344450',dialogue:'#E5EBF1',dialogueText:'#344450',button:'#526B80'}},
 {id:'purple',name:'奶油紫',base:'#C9B9DB',colors:{...light('#F5F2F1','#FFFDFB','#715C7C','#7A6D80','#D9CFDF','#EAE2F0'),input:'#FFFEFE',text:'#443D4A',userBubbleText:'#443D4A',assistantBubble:'#FAF7FC',assistantBubbleText:'#443D4A',dialogue:'#EEE8F3',dialogueText:'#443D4A',button:'#766080'}},
 {id:'caramel',name:'焦糖棕',base:'#B78F73',colors:{...light('#F5F1E9','#FDF9F0','#805B42','#786A5D','#D9CBBB','#E9D9C8'),input:'#FFFDFA',text:'#493D32',userBubbleText:'#493D32',assistantBubble:'#F8F1E7',assistantBubbleText:'#493D32',dialogue:'#F0E3D4',dialogueText:'#493D32',button:'#805C45'}},
];
/** Original system appearance, intentionally distinct from the Classic White preset. */
export function legacyColors(color='#c5d1c3'):ThemeColors{return {...light(hexColor(color)??'#C5D1C3','#F9FAF3','#4E6856','#637667','#D0DCCB','#D4E1CD'),input:'#FFFFF8',text:'#34483E',assistantBubble:'#FFFDF1',assistantBubbleText:'#34483E',dialogue:'#EAF2E9',dialogueText:'#40584A',speaker:'#718C77',action:'#899A8C'};}
export function hexColor(value:unknown):string|undefined{return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toUpperCase():undefined;}
export function validatePalette(value:unknown):asserts value is ThemePalette{
 const p=value as ThemePalette;
 if(!p||typeof p!=='object'||Array.isArray(p)||p.version!==1||Object.keys(p).some(k=>!['version','presetId','colors'].includes(k))||p.presetId!==undefined&&!themePresets.some(t=>t.id===p.presetId)||!p.colors||typeof p.colors!=='object'||Array.isArray(p.colors)||Object.keys(p.colors).length!==Object.keys(colorLabels).length||Object.keys(colorLabels).some(k=>!hexColor(p.colors[k as ThemeColor])))throw Error('主题配色格式无效，未保存。');
}
export function themeVariables(colors:ThemeColors){
 const rgb=(s:string)=>s.slice(1).match(/../g)!.map(v=>parseInt(v,16));
 const mix=(a:string,b:string,t:number)=>'#'+rgb(a).map((n,i)=>Math.round(n*(1-t)+rgb(b)[i]*t).toString(16).padStart(2,'0')).join('');
 return {...Object.fromEntries(Object.entries(colors).map(([k,v])=>[`--theme-${k}`,v])),
 '--theme-glass-rgb':rgb(colors.card).join(' '),'--theme-shadow':'rgba(0,0,0,.22)','--theme-shade':'rgba(0,0,0,.3)',
 '--theme-dangerSurface':mix(colors.card,colors.danger,.14),'--theme-accentSoft':mix(colors.card,colors.accent,.14),
 '--theme-mediaBackdrop':'rgba(12,16,20,.94)','--theme-mediaText':'#FFFFFF',
 '--theme-chat-image-wash':`rgba(${rgb(colors.page).join(',')},.4)`};
}
export function contrast(a:string,b:string){const luminance=(s:string)=>{const c=s.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}

export function storedPalette(value:unknown):ThemePalette|undefined{try{validatePalette(value);return value;}catch{return undefined;}}

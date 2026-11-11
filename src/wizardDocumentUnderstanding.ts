/** Lossless paragraph evidence, not a claim of semantic truth. Mixed categories are intentional. */
export type DocumentKind='background'|'character'|'event'|'rule'|'secret'|'direction';
export function documentParagraphs(body:string){
 const parts:{start:number;end:number;text:string;kinds:DocumentKind[];certainty:'unreviewed'}[]=[];
 const pattern=/[^\r\n]+(?:\r\n|\r|\n|$)|(?:\r\n|\r|\n)/g;let m:RegExpExecArray|null;
 while((m=pattern.exec(body))){const text=m[0],kinds:DocumentKind[]=[];
  if(/背景|世界|地理|城市|时代/.test(text))kinds.push('background');
  if(/人物|角色|姓名|身份|性格/.test(text))kinds.push('character');
  if(/事件|曾经|发生|过去|当年/.test(text))kinds.push('event');
  if(/规则|必须|禁止|不得|如果|只有|资源|时间/.test(text))kinds.push('rule');
  if(/秘密|隐瞒|真相|未公开|不知情/.test(text))kinds.push('secret');
  if(/计划|将来|方向|伏笔|可能|打算/.test(text))kinds.push('direction');
  parts.push({start:m.index,end:m.index+text.length,text,kinds,certainty:'unreviewed'});
 }
 return parts;
}

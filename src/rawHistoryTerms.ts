/** Local topic expansion only. It never converts a speaker's words into a fact. */
const concepts:readonly [string,readonly string[]][]=[
 ['menstrual',['来月经','月经','生理期','例假','大姨妈','经期']],
 ['health',['月经','生理期','例假','大姨妈','经期','肚子','腹痛','疼','痛','难受','不舒服','身体','生病','发烧','感冒','医院','过敏']],
 ['marriage',['结婚','婚姻','婚礼','领证','成家','不婚']],
 ['promise',['答应','承诺','约定','说好','保证','失约']],
 ['travel',['旅行','旅游','出游','旅途']],
 ['food',['吃饭','晚饭','午饭','早餐','饮食','餐厅']],
 ['work',['工作','上班','加班','公司','同事']],
 ['study',['学习','考试','上课','学校']],
 ['relationship',['恋爱','恋人','伴侣','分手','关系','和好','和解']],
 ['exhibition',['画展','展览','美术馆']],
];
const stop=new Set(['今天','明天','昨天','现在','晚上','下午','上午','我们','你们','自己','这个','那个','一下','还是','已经','什么','怎么','觉得','可以','因为','所以','时候','一个','不是','不想','喜欢','讨厌','really','about','with','that','this','have']);
export function historyTerms(text:string){
 const normalized=text.normalize('NFKC').toLowerCase(),topics:string[]=[];
 for(const [name,aliases] of concepts)if(aliases.some(a=>normalized.includes(a)))topics.push('@'+name);
 const lexical=new Set<string>();
 for(const word of normalized.match(/[\p{Script=Han}]+|[a-z0-9_]{3,}/gu)??[]){
  if(/^[\p{Script=Han}]+$/u.test(word)){for(let i=0;i<word.length-1;i++){const part=word.slice(i,i+2);if(!stop.has(part))lexical.add(part);if(lexical.size>=256)break;}}
  else if(!stop.has(word))lexical.add(word);
  if(lexical.size>=256)break;
 }
 return [...topics,...lexical];
}
export const uncertainHistory=(text:string)=>/假如|假设|如果|要是|也许|可能|猜测|开玩笑|逗你|玩笑|并非真的|并不是真的|举个例子|比如说/u.test(text);
export const importantHistory=(text:string)=>/月经|生理期|例假|大姨妈|经期|不喜欢|讨厌|不想|不愿|不要|拒绝|过敏|承诺|答应|约定|说好|保证|我们.{0,20}(?:去过|一起|第一次|上次)|生病|发烧|受伤|分手|伴侣|结婚|婚姻|离婚|家人|失业|入职|离职/u.test(text);
export const greetingQuery=(text:string)=>/^(?:早上好|早安|晚上好|晚安|你好|我回来了|在吗|今天怎么样|好累|有点累)[。！!？?，,\s]*$/u.test(text.trim());

export const durableHistory=(text:string)=>/不喜欢|讨厌|不想|不愿|不要|拒绝|偏好|喜欢|愿意|希望|宁愿|改变想法|改变主意|过敏|承诺|答应|约定|说好|保证|我们.{0,20}(?:去过|一起|第一次|上次)/u.test(text);

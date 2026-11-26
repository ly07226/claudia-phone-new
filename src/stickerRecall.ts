import type {StickerMeta} from './stickerLibrary';
const moods=['开心 高兴 笑 哈哈 可爱 萌 喜欢','难过 哭 委屈 眼泪 伤心','生气 愤怒 气 恼 怒','抱 抱抱 亲 爱 想你 贴贴','困 睡 晚安 累','疑问 问号 不懂 思考','收到 知道 好的 同意','无语 尴尬 沉默'];
function tokens(s:string){const t=s.toLowerCase();const out=new Set(t.match(/[a-z0-9]{2,}/g)||[]);for(const part of t.match(/[\p{Script=Han}]+/gu)||[]){for(let i=0;i<part.length-1;i++)out.add(part.slice(i,i+2));}return out;}
export function rankStickers(rows:StickerMeta[],recent:string,seed:string){
 const query=tokens(recent);const active=moods.filter(m=>m.split(' ').some(w=>recent.includes(w)));
 const hash=(v:string)=>{let h=2166136261;for(const c of v)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
 return rows.map(r=>{const label=r.label+' '+r.group;let score=0;for(const token of tokens(label))if(query.has(token))score+=3;for(const mood of active)if(mood.split(' ').some(w=>label.includes(w)))score+=4;return {r,score,tie:hash(seed+r.id)};}).sort((a,b)=>b.score-a.score||a.tie-b.tie).map(x=>x.r);
}

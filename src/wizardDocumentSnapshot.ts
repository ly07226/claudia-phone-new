import {readLongNarrative,type LongNarrative} from './wizardLongNarrative';
import {listSimulatorReviews,listSimulatorDecisions,type SavedSimulatorReview,type SimulatorDecision} from './wizardSimulatorReviewStore';
import {planSimulatorAnalysis} from './wizardSimulatorCoverage';
import {indexSimulatorDocument} from './wizardSimulatorDocument';
import {simulatorAuditStatus} from './wizardSimulatorAudit';
import {validateRuntimeConfig,type DocumentRuntimeConfig} from './wizardRuntimeConfig';
export interface StoryDocumentSnapshot {referenceOnly?:true;automation?:{version:1;chunkChars:number;deferred:number};version:1;mode:'narrative'|'simulation';source:LongNarrative;reviews:SavedSimulatorReview[];decisions:SimulatorDecision[];runtime?:DocumentRuntimeConfig;revision:string}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined).map(k=>[k,canonical((value as Record<string,unknown>)[k])]));return value;}
export async function snapshotRevision(x:Omit<StoryDocumentSnapshot,'revision'>){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(x))));return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');}
export function validateDocumentSnapshot(x:StoryDocumentSnapshot){
 if(!x||x.version!==1||!['narrative','simulation'].includes(x.mode)||!x.source||typeof x.source.body!=='string'||!x.source.body.trim()||x.source.body.length>2000000||typeof x.source.id!=='string'||typeof x.source.name!=='string'||x.source.name.length>255||!Array.isArray(x.reviews)||!Array.isArray(x.decisions)||!/^[a-f0-9]{64}$/.test(x.revision))throw Error('原文归档结构无效。');
 const file=x.source.originalFile;if(file&&(typeof file.mime!=='string'||typeof file.base64!=='string'||file.base64.length>28*1024*1024||(file.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))))throw Error('原始文件归档损坏。');
 if(x.referenceOnly!==undefined){if(x.referenceOnly!==true||x.mode!=='narrative'||x.runtime||x.automation||x.reviews.length||x.decisions.length)throw Error('原文叙事归档不应携带未校验的执行配置。');return;}
 if(!x.reviews.every(r=>r.sourceId===x.source.id)||!x.decisions.every(d=>d.sourceId===x.source.id&&d.sourceLength===x.source.body.length&&['accepted','rejected','needs_review'].includes(d.decision)))throw Error('文档审核归属无效。');
 if(x.automation&&(x.automation.version!==1||x.automation.chunkChars!==2000||!Number.isSafeInteger(x.automation.deferred)||x.automation.deferred<0))throw Error('自动准备记录无效。');
 const chunks=planSimulatorAnalysis(x.source.body,indexSimulatorDocument(x.source.body),x.automation?.chunkChars);if(!simulatorAuditStatus(chunks,x.reviews,x.decisions).ready)throw Error(x.automation?'剧本准备记录不完整，请重新准备，原文未丢失。':'旧版文档审核记录不完整，请重新导入进行自动准备。');
 for(const d of x.decisions){if(d.playerKnown!==undefined&&typeof d.playerKnown!=='boolean')throw Error('玩家知识状态无效。');if(d.protectedTerms&&(!Array.isArray(d.protectedTerms)||d.protectedTerms.length>12||d.protectedTerms.some(t=>typeof t!=='string'||t.trim().length<2||!d.quote.includes(t))))throw Error('保密词必须是对应原文片段。');if(d.revealWhen&&(typeof d.revealWhen.key!=='string'||!['string','number','boolean'].includes(typeof d.revealWhen.equals)||typeof d.revealWhen.equals==='number'&&!Number.isFinite(d.revealWhen.equals)))throw Error('秘密揭示条件无效。');if(d.knownBy&&(!Array.isArray(d.knownBy)||d.knownBy.some(n=>typeof n!=='string'||n.length>80)))throw Error('知识持有人无效。');}
 if(x.mode==='simulation'){if(!x.runtime)throw Error('模拟运行需要明确状态声明。');validateRuntimeConfig(x.runtime);}else if(x.runtime)throw Error('普通故事不能强制启用数值模拟。');
}
export async function createDocumentSnapshot(id:string,mode:'narrative'|'simulation',runtime?:DocumentRuntimeConfig):Promise<StoryDocumentSnapshot>{
 const source=await readLongNarrative(id);if(!source)throw Error('导入原文已丢失。');let reviews:SavedSimulatorReview[]=[],decisions:SimulatorDecision[]=[];if(!source.preparation){try{reviews=await listSimulatorReviews(id,source.body.length);decisions=await listSimulatorDecisions(id,source.body.length);}catch{/* Auxiliary analysis storage is not required for original-text play. */}}
 const prepared=source.preparation;const {preparation,...archivedSource}=source;
 let content:Omit<StoryDocumentSnapshot,'revision'>={version:1,mode:'narrative',source:archivedSource,reviews:[],decisions:[],referenceOnly:true};
 const candidate:Omit<StoryDocumentSnapshot,'revision'>={version:1,mode:prepared?.runtime?'simulation':prepared?'narrative':mode,source:archivedSource,reviews:prepared?.reviews??reviews,decisions:prepared?.decisions??decisions,...(prepared?{automation:{version:1,chunkChars:prepared.chunkChars,deferred:prepared.deferred}}:{}),...((prepared?.runtime??runtime)?{runtime:prepared?.runtime??runtime}:{})};
 // An absent, partial or malformed analysis is not a prerequisite for ordinary play.
 try{const checked={...candidate,revision:'0'.repeat(64)};validateDocumentSnapshot(checked);await(await import('./wizardSimulatorRuntime')).compileSimulatorRuntime(source.id,checked);content=candidate;}catch{/* Archive the source without claiming any unverified advanced rules. */}
 const snapshot={...content,revision:await snapshotRevision(content)};validateDocumentSnapshot(snapshot);
 if(new TextEncoder().encode(JSON.stringify(snapshot)).length>12*1024*1024)throw Error('完整文档归档超过单世界 12 MiB 安全容量，未截断或创建世界；本机原文件与草稿仍保留。');return snapshot;
}
export async function verifyDocumentSnapshot(x:StoryDocumentSnapshot){validateDocumentSnapshot(x);const {revision,...content}=x;if(await snapshotRevision(content)!==revision)throw Error('原文或审核归档摘要不匹配。');}

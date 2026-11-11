import type {SimulatorChunkReview} from './wizardSimulatorReview';
const database='claudia-wizard-simulator-reviews-v1',store='reviews',decisions='decisions';
export type SimulatorFindingDecision='accepted'|'rejected'|'needs_review';
export interface SimulatorDecision {id:string;sourceId:string;sourceLength:number;chunkIndex:number;findingStart:number;findingEnd:number;quote:string;decision:SimulatorFindingDecision;updatedAt:number}
export interface SavedSimulatorReview {id:string;sourceId:string;sourceLength:number;sourceName:string;review:SimulatorChunkReview;savedAt:number}
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(database,2);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store,{keyPath:'id'});if(!request.result.objectStoreNames.contains(decisions))request.result.createObjectStore(decisions,{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??Error('审核数据库无法打开'));});}
export async function saveSimulatorReview(sourceId:string,sourceLength:number,sourceName:string,review:SimulatorChunkReview):Promise<void>{
 const db=await open();return new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');const item:SavedSimulatorReview={id:sourceId+':'+review.chunkIndex,sourceId,sourceLength,sourceName,review,savedAt:Date.now()};tx.objectStore(store).put(item);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error??Error('审核结果保存失败'));};tx.onabort=()=>{db.close();reject(tx.error??Error('审核保存已取消'));};});
}
export async function listSimulatorReviews(sourceId:string,sourceLength:number):Promise<SavedSimulatorReview[]>{
 const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');const request=tx.objectStore(store).getAll();let result:SavedSimulatorReview[]=[];request.onsuccess=()=>{result=(request.result as SavedSimulatorReview[]).filter(x=>x.sourceId===sourceId&&x.sourceLength===sourceLength).sort((a,b)=>a.review.chunkIndex-b.review.chunkIndex);};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error??Error('读取审核记录失败'));};tx.onabort=()=>{db.close();reject(tx.error??Error('读取审核记录已取消'));};});
}

export async function saveSimulatorDecision(input:Omit<SimulatorDecision,'id'|'updatedAt'>):Promise<void>{
 const db=await open();return new Promise<void>((resolve,reject)=>{const tx=db.transaction(decisions,'readwrite');const id=[input.sourceId,input.chunkIndex,input.findingStart,input.findingEnd].join(':');tx.objectStore(decisions).put({...input,id,updatedAt:Date.now()} satisfies SimulatorDecision);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error??Error('审核决定保存失败'));};tx.onabort=()=>{db.close();reject(tx.error??Error('审核决定保存已取消'));};});
}
export async function listSimulatorDecisions(sourceId:string,sourceLength:number):Promise<SimulatorDecision[]>{
 const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(decisions,'readonly');const request=tx.objectStore(decisions).getAll();let items:SimulatorDecision[]=[];request.onsuccess=()=>{items=(request.result as SimulatorDecision[]).filter(x=>x.sourceId===sourceId&&x.sourceLength===sourceLength);};tx.oncomplete=()=>{db.close();resolve(items);};tx.onerror=()=>{db.close();reject(tx.error??Error('审核决定读取失败'));};tx.onabort=()=>{db.close();reject(tx.error??Error('审核决定读取已取消'));};});
}

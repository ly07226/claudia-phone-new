import type {SimulatorChunkReview} from './wizardSimulatorReview';
const database='claudia-wizard-simulator-reviews-v1',store='reviews';
export interface SavedSimulatorReview {id:string;sourceId:string;sourceLength:number;sourceName:string;review:SimulatorChunkReview;savedAt:number}
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(database,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store,{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??Error('审核数据库无法打开'));});}
export async function saveSimulatorReview(sourceId:string,sourceLength:number,sourceName:string,review:SimulatorChunkReview):Promise<void>{
 const db=await open();return new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');const item:SavedSimulatorReview={id:sourceId+':'+review.chunkIndex,sourceId,sourceLength,sourceName,review,savedAt:Date.now()};tx.objectStore(store).put(item);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error??Error('审核结果保存失败'));};tx.onabort=()=>{db.close();reject(tx.error??Error('审核保存已取消'));};});
}
export async function listSimulatorReviews(sourceId:string,sourceLength:number):Promise<SavedSimulatorReview[]>{
 const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');const request=tx.objectStore(store).getAll();let result:SavedSimulatorReview[]=[];request.onsuccess=()=>{result=(request.result as SavedSimulatorReview[]).filter(x=>x.sourceId===sourceId&&x.sourceLength===sourceLength).sort((a,b)=>a.review.chunkIndex-b.review.chunkIndex);};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error??Error('读取审核记录失败'));};tx.onabort=()=>{db.close();reject(tx.error??Error('读取审核记录已取消'));};});
}

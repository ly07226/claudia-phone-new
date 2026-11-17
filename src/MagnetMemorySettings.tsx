import {useEffect,useState} from 'react';
import {liveQuery} from 'dexie';
import {db} from './store';
import type {MemoryScope} from './memoryTypes';
import {listMemories,memoryTagSnapshot} from './memoryStore';
import {runDedicatedTagBatch} from './memoryMagnetProvider';
import type {TagTaxonomy} from './memoryMagnetTagger';
const defaults:TagTaxonomy={emotion:[],topic:[]};
const lines=(value:string)=>[...new Set(value.split(/[\n,，、]+/).map(x=>x.trim()).filter(Boolean))].slice(0,40);
export function MagnetMemorySettings({scope}:{scope:MemoryScope}){
 const [taxonomy,setTaxonomy]=useState<TagTaxonomy>(defaults);
 const [emotion,setEmotion]=useState(''),[topic,setTopic]=useState('');
 const [stats,setStats]=useState({total:0,tagged:0,failed:0});
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let alive=true;const sub=liveQuery(async()=>{
  const [global,all,tags]=await Promise.all([db.themes.get('global'),listMemories(scope),memoryTagSnapshot(scope)]);
  return {taxonomy:global?.magnetTaxonomy as TagTaxonomy|undefined,total:all.entries.length,tagged:tags.records.length,failed:tags.failures.length};
 }).subscribe({next:data=>{if(!alive)return;const tax=data.taxonomy??defaults;setTaxonomy(tax);setEmotion(tax.emotion.join('、'));setTopic(tax.topic.join('、'));setStats({total:data.total,tagged:data.tagged,failed:data.failed});},error:()=>{if(alive)setNotice('标签状态读取失败，请稍后重试。');}});
 return()=>{alive=false;sub.unsubscribe();};},[scope]);
 async function save(){
  const next={emotion:lines(emotion),topic:lines(topic)};
  setBusy(true);try{
   await db.transaction('rw',db.themes,async()=>{
    const global=await db.themes.get('global');
    if(!global)throw Error('global-theme-missing');
    await db.themes.update('global',{magnetTaxonomy:next});
   });
   setTaxonomy(next);setNotice('标签类目已保存。修改类目不会偷偷重刷已有标签。');
  }catch{setNotice('保存失败，原类目未修改。');}finally{setBusy(false);}
 }
 async function run(retry:boolean){
  if(!taxonomy.emotion.length||!taxonomy.topic.length){setNotice('请先保存情感与主题类目。');return;}
  if(!window.confirm(retry?'仅手动恢复失败打标，可能重复产生 API 费用，是否继续？':'将调用总结专用 API，为最多20条未打标记忆生成标签，可能产生费用，是否继续？'))return;
  setBusy(true);try{
   const result=await runDedicatedTagBatch(scope,taxonomy,20,retry);
   setNotice(`已检查 ${result.seen} 条，成功 ${result.tagged} 条，失败 ${result.failed} 条。失败条目不会自动重试。`);
  }catch{setNotice('批量打标未能完成，已保存的标签不会清空。');}finally{setBusy(false);}
 }
 return <div className="memory-magnet-settings">
  <h3>磁铁召回 · StarHub</h3>
  <p>长期记忆先打标签，再按聊天触发词召回。标签与记忆版本绑定；原文、角色与世界隔离不变。</p>
  <p role="status">有效记忆 {stats.total} 条 · 已打标 {stats.tagged} 条 · 失败待恢复 {stats.failed} 条</p>
  <label>情感类目（用逗号或换行分隔）<textarea value={emotion} onChange={e=>setEmotion(e.target.value)} rows={3}/></label>
  <label>主题类目（用逗号或换行分隔）<textarea value={topic} onChange={e=>setTopic(e.target.value)} rows={3}/></label>
  <div className="memory-actions"><button disabled={busy} onClick={()=>void save()}>保存类目</button><button disabled={busy} onClick={()=>void run(false)}>手动批量打标</button><button disabled={busy||!stats.failed} onClick={()=>void run(true)}>恢复失败任务</button></div>
  {notice&&<p role="status">{notice}</p>}
  <p>打标不在每轮聊天时调用 API。旧记忆保留原文，等待补打标；失败条目不会自动重复计费。</p>
 </div>;
}

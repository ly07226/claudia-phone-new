import {useEffect,useRef,useState} from 'react';
import {Eye,EyeOff} from 'lucide-react';
import {fetchModels} from './apiModels';
import {providers,type ModelOption} from './api';
import {saveSummaryApi,summaryTransport,testSummaryApi,type DedicatedSummaryApi} from './dedicatedSummaryApi';
import './summaryApiMobile.css';
export function SummaryApiEditor({value,onChange}:{value:DedicatedSummaryApi;onChange:(v:DedicatedSummaryApi)=>void}){
 const [visible,setVisible]=useState(false),[models,setModels]=useState<ModelOption[]>([]),[search,setSearch]=useState(''),[busy,setBusy]=useState(''),[notice,setNotice]=useState('');
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>{controller.current?.abort();controller.current=null;setModels([]);},[value.baseUrl,value.apiKey,value.provider,value.protocol]);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const change=(patch:Partial<DedicatedSummaryApi>)=>onChange({...value,...patch});
 async function load(){if(busy)return;const c=new AbortController();controller.current=c;setBusy('models');setNotice('');try{const result=await fetchModels(summaryTransport(value).config,value.apiKey,c.signal);if(!c.signal.aborted){setModels(result.models);setNotice(result.result.message);}}catch(e){if(!c.signal.aborted)setNotice(e instanceof Error?e.message:'获取模型失败，可手动填写');}finally{if(controller.current===c){controller.current=null;setBusy('');}}}
 async function test(){if(busy)return;setBusy('test');setNotice('');try{setNotice((await testSummaryApi(value)).message);}catch(e){setNotice(e instanceof Error?e.message:'测试失败');}finally{setBusy('');}}
 async function save(){if(busy)return;setBusy('save');setNotice('');try{await saveSummaryApi(value);setNotice('总结专用 API 已保存');}catch(e){setNotice(e instanceof Error?e.message:'保存失败');}finally{setBusy('');}}
 return <div className="summary-api-editor">
 <h3>总结专用 API</h3><p>全局共用接口，日常与各世界的总结记忆仍分别保存；不影响聊天 API。</p>
 <label>服务商<select value={value.provider} onChange={e=>{const provider=e.target.value as DedicatedSummaryApi['provider'];change({contextWindowTokens:undefined,modelOutputTokens:undefined,provider,baseUrl:providers[provider]?.defaultUrl??'',protocol:provider==='custom'?'openai-chat':undefined});}}>{Object.entries(providers).filter(([k])=>['openai-compatible','openai','gemini','openrouter','custom'].includes(k)).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></label>
 {value.provider==='custom'&&<label>协议<select value={value.protocol??'openai-chat'} onChange={e=>change({protocol:e.target.value as 'openai-chat'|'gemini'})}><option value="openai-chat">OpenAI Chat</option><option value="gemini">Gemini</option></select></label>}
 <label>API 地址<input type="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value.baseUrl} onChange={e=>change({baseUrl:e.target.value,contextWindowTokens:undefined,modelOutputTokens:undefined})} placeholder="https://api.example.com/v1"/></label>
 <label>API Key<span className="summary-api-key"><input type={visible?'text':'password'} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value.apiKey} onChange={e=>change({apiKey:e.target.value})}/><button type="button" aria-label={visible?'隐藏密钥':'显示密钥'} onClick={()=>setVisible(x=>!x)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
 <div className="memory-actions"><button type="button" disabled={!!busy} onClick={()=>void load()}>{busy==='models'?'获取中…':'获取模型'}</button></div>
 {models.length>0&&<><label>搜索模型<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>选择模型<select value={models.some(m=>m.id===value.model)?value.model:''} onChange={e=>{if(e.target.value)change({model:e.target.value,contextWindowTokens:models.find(m=>m.id===e.target.value)?.contextWindowTokens,modelOutputTokens:models.find(m=>m.id===e.target.value)?.modelOutputTokens});}}><option value="">手动填写或选择</option>{models.filter(m=>m.id.toLowerCase().includes(search.toLowerCase())).slice(0,200).map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</select></label></>}
 <label>模型 ID（可手动填写）<input value={value.model} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={e=>change({model:e.target.value,contextWindowTokens:models.find(m=>m.id===e.target.value)?.contextWindowTokens,modelOutputTokens:models.find(m=>m.id===e.target.value)?.modelOutputTokens})}/></label>
 <p>{value.contextWindowTokens?`模型接口报告输入能力 ${value.contextWindowTokens} Token；实际请求仍预留输出及提示词预算。`:'未取得模型上下文能力，使用保守预算；大区间仍会自动分片。'}</p>
 <label>Temperature<input type="number" min={0} max={2} step={0.1} value={value.temperature} onChange={e=>change({temperature:Number(e.target.value)})}/></label>
 <label>最大输出 Token<input type="number" min={1} max={1000000} value={value.maxTokens} onChange={e=>change({maxTokens:Number(e.target.value)})}/></label>
 <label>启用接口<input type="checkbox" checked={value.enabled} onChange={e=>change({enabled:e.target.checked})}/></label>
 <div className="memory-actions"><button type="button" disabled={!!busy} onClick={()=>void test()}>{busy==='test'?'测试中…':'测试连接（当前表单）'}</button><button type="button" disabled={!!busy} onClick={()=>void save()}>{busy==='save'?'保存中…':'保存接口'}</button></div>
 {notice&&<p role="status">{notice}</p>}<p className="memory-scope">连接测试可能产生少量费用。密钥保存在本机全局设置中，请妥善保管备份文件。</p>
 </div>;
}
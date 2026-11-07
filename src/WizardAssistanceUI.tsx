import type {ScriptWizardDraft} from './scriptWizardDraft';
import {wizardPaces} from './scriptWizardDraft';
import {characterFields,validateWizardSuggestions,wizardCharacterPersona,type WizardAssistanceKind} from './wizardAssistanceTypes';
export function WizardAssistanceUI({kind,draft:d,busy,onRequest,onChange,onError}:{kind:WizardAssistanceKind;draft:ScriptWizardDraft;busy:boolean;onRequest:()=>void;onChange:(patch:Partial<ScriptWizardDraft>)=>void;onError:(message:string)=>void}){
 const labels={pacing:'AI 推荐节奏与方向',character:'AI 生成角色',opening:'AI 推荐开局'};
 function apply(patch:Partial<ScriptWizardDraft>){if(!confirm('采用此推荐并更新对应草稿字段？其他输入保持不变。'))return;onChange(patch);}
 return <section className="wizard-ai" aria-label={labels[kind]}>
  {kind==='character'&&<label>角色补充要求<textarea aria-label="角色补充要求" maxLength={2000} value={d.aiCharacterRequirements??''} onChange={e=>onChange({aiCharacterRequirements:e.target.value})}/></label>}
  <button type="button" disabled={busy||!d.synopsis.trim()} onClick={onRequest}>{busy?'正在请求 AI…':`${labels[kind]}（消耗 Token）`}</button>
  <p className="wizard-note">仅主动点击时请求当前默认模型。结果不会自动覆盖输入；实际请求可能计费，失败不会自动重试。</p>
  {kind==='pacing'&&d.suggestions?.pacing?.map((r,i)=><article key={i}><h3>{r.title}</h3><p>{r.description}</p><p>节奏建议：{wizardPaces[r.pace]}</p><button disabled={busy} onClick={()=>apply({pace:r.pace,customPace:'',direction:`${r.title}\n${r.description}`})}>采用方向 {i+1}</button></article>)}
  {kind==='opening'&&d.suggestions?.opening?.map((r,i)=><article key={i}><h3>{r.title}</h3><p>{r.timeAndPlace}</p><p>{r.conflict}</p><p>{r.connection}</p><button disabled={busy} onClick={()=>apply({opening:`${r.title}\n时间与场景：${r.timeAndPlace}\n冲突或悬念：${r.conflict}\n人物联系：${r.connection}`})}>采用开局 {i+1}</button></article>)}
  {kind==='character'&&d.suggestions?.character&&<fieldset><legend>AI 角色预览 · 尚未创建实体</legend>{characterFields.map(([key,label,max])=><label key={key}>{label}<textarea aria-label={`AI角色${label}`} maxLength={max} value={d.suggestions!.character![key]} onChange={e=>onChange({suggestions:{...d.suggestions,character:{...d.suggestions!.character!,[key]:e.target.value}}})}/></label>)}<button disabled={busy||d.customCharacters.length>=10} onClick={()=>{try{validateWizardSuggestions({character:d.suggestions!.character});const c=d.suggestions!.character!,persona=wizardCharacterPersona(c);if(persona.length>4000)throw Error('角色资料超过 4000 字符，请缩短后采用。');onChange({customCharacters:[...d.customCharacters,{name:c.name,persona,speakingStyle:'',worldSetting:`与主控的关系：${c.relationship}`}],suggestions:{...d.suggestions,character:undefined}});}catch(e){onError(e instanceof Error?e.message:'角色资料无效，未采用。');}}}>采用此角色（加入草稿）</button></fieldset>}
 </section>;
}

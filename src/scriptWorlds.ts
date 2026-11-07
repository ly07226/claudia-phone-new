import {db,type World} from './store';
import {validateScriptConfig} from './scriptValidation';
/** Atomic update against the current record, preserving unrelated metadata. */
export async function saveScriptWorld(form:Partial<World>){
  return db.transaction('rw',db.worlds,async()=>{
    const current=form.id?await db.worlds.get(form.id):undefined;
    if(form.id&&!current)throw Error('世界已不存在，未重新创建。');
    if(!form.name?.trim())throw Error('请填写世界名称。');
    if(form.script)validateScriptConfig(form.script);
    if(current?.script) {
      validateScriptConfig(current.script);
      if(!form.script||form.script.definitionRevision!==current.script.definitionRevision)throw Error('剧本设定已在其他窗口更新，请重新打开编辑。');
    }
    const next:World={...current,...form,id:current?.id??crypto.randomUUID(),name:form.name.trim(),description:form.description??'',rules:form.rules??'',background:form.background??'',createdAt:current?.createdAt??Date.now()};
    if(current?.storyPreferences)next.storyPreferences=current.storyPreferences;
    if(form.script){
      const definition=(w:Partial<World>)=>JSON.stringify([w.name?.trim()??'',w.description??'',w.rules??'',w.background??'',w.script?.playMode,w.script?.opening,w.script?.direction??'',w.script?.pace,w.script?.customPace??'',w.script?.perspective??'second']);
      const revision=current?.script?current.script.definitionRevision+Number(definition(current)!==definition(next)):1;
      if(!Number.isSafeInteger(revision))throw Error('剧本设定版本超出安全范围。');
      next.script={...form.script,definitionRevision:revision};
    }else delete next.script;
    await db.worlds.put(next);return next;
  });
}

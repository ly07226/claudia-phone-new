import Dexie from 'dexie';
import {db,defaultTheme,defaultItems} from './store';
import {backupTables,ensure,checkAbort,rowBytes,sha,utf8,type BackupTable} from './backupFormat';
import {readBackup,verifiedCandidate,eachBackupRow,sanitizeConfig,type IntegrityReport} from './backupService';
import {bound,keep,digest,same,validate,openRestoreDatabase,exactSchema,type DatabaseDigest} from './restoreData';
import {usableApi} from './apiSelection';
import {messageFingerprint} from './timelines';
export interface ImportOptions {
  mode:'overwrite'|'merge';apiReplace:boolean;story:boolean;desktop:boolean;identities:boolean;api:boolean;
  conflicts:'copy'|'skip';apiConflict:'copy'|'keep';identityConflict:'keep'|'replace';keys:'none'|'missing'|'replace';
}
export const defaultImportOptions:ImportOptions={mode:'overwrite',apiReplace:false,story:true,desktop:true,identities:true,api:true,conflicts:'copy',apiConflict:'copy',identityConflict:'keep',keys:'none'};
export const storyTables:BackupTable[]=['worlds','characters','worldProfiles','conversations','messages','messageVariants','messageRevisions','conversationSnapshots','timelines','pathNodes','lorebooks','loreEntries'];
const ownedTables:BackupTable[]=['messages','messageVariants','messageRevisions','conversationSnapshots','timelines','pathNodes'];
export interface DataCounts {characters:number;conversations:number;messages:number;worlds:number;lorebooks:number;identities:number;apiConfigs:number;timelines:number;assets:number}
export interface ImportPreview {formatVersion:number;schemaVersion:number;createdAt:string;credentials:IntegrityReport['credentials'];incoming:DataCounts;current:DataCounts;result:DataCounts;added:DataCounts;duplicates:number;conflicts:number;changed:number;bytes:number;warnings:string[];options:ImportOptions;manifestDigest:string;credentialChanges:{added:number;replaced:number;removed:number;kept:number;names:string[]}}
export interface ImportPlan {preview:ImportPreview;dispose:()=>Promise<void>}
interface Internal {database:Dexie;targetName:string;before:DatabaseDigest;after:DatabaseDigest}
const plans=new WeakMap<ImportPlan,Internal>();
export function getImportPlan(plan:ImportPlan,target:Dexie){const p=plans.get(plan);ensure(p&&p.database.isOpen()&&p.targetName===target.name,'导入预览已失效或目标手机不同，请重新预览。');return p;}
export async function dataCounts(d:Dexie):Promise<DataCounts>{const t=await d.table('themes').get('global');return {characters:await d.table('characters').count(),conversations:await d.table('conversations').count(),messages:await d.table('messages').count(),worlds:await d.table('worlds').count(),lorebooks:await d.table('lorebooks').count(),identities:Object.keys(t?.userIdentities??{}).length,apiConfigs:await d.table('apiConfigs').count(),timelines:d.tables.some(t=>t.name==='timelines')?await d.table('timelines').count():0,assets:await d.table('assets').count()};}
async function equal(table:BackupTable,a:any,b:any){if(table==='apiConfigs'&&b){a={...a,isDefault:false,createdAt:0,updatedAt:0};b={...b,isDefault:false,createdAt:0,updatedAt:0};}return !!b&&await sha(await rowBytes(table,a))===await sha(await rowBytes(table,b));}
/** Planning writes only a new isolated database. All accepted data and references
 * are revalidated before the existing atomic restore service may commit this plan. */
export async function prepareImport(files:File[],options:ImportOptions,{database=db,password,signal}: {database?:Dexie;password?:string;signal?:AbortSignal}={}):Promise<ImportPlan>{
  exactSchema(database);const c=new AbortController();if(signal?.aborted)c.abort();const abort=()=>c.abort();signal?.addEventListener('abort',abort,{once:true});
  let cleanup:Awaited<ReturnType<typeof readBackup>>|undefined,target:Dexie|undefined;const name='claudia-import-plan-'+crypto.randomUUID();const timeout=setTimeout(()=>c.abort(),300000),hidden=()=>{if(document.hidden)c.abort();};document.addEventListener('visibilitychange',hidden);
  try{
  const checked=cleanup=await readBackup(files,{mode:'rehearse',password,signal:c.signal});const source=verifiedCandidate(checked)!;
  if(source.verno===5){source.close();source.version(6).stores({timelines:'id,conversationId,parentTimelineId',pathNodes:'id,conversationId,[conversationId+parentNodeId+fingerprint]'});await source.open();}

    ensure(options.story||options.desktop||options.identities||options.api,'请至少选择一项导入范围。');
    ensure(options.keys==='none'||(options.api&&checked.report.credentials==='encrypted'),'导入密钥必须选择 API 范围且备份确实包含加密凭据。');
    target=await openRestoreDatabase(name);const result=target;
    let before!:DatabaseDigest;
    await database.transaction('r',database.tables,async tx=>{const view=bound(database,tx);before=await digest(view,c.signal);for(const table of backupTables)await eachBackupRow(view,table,async row=>{await keep(tx,Dexie.ignoreTransaction(()=>result.table(table).add(row)));},c.signal);});
    const current=await dataCounts(result),incoming=await dataCounts(source),warnings:string[]=[...checked.report.warnings];
    const historicalOwners=new Map<string,string>();
    function own(table:string,id:string,cid:string){const key=table+':'+id;ensure(!historicalOwners.has(key)||historicalOwners.get(key)===cid,'历史消息或版本 ID 跨会话重复，无法安全重映射，已拒绝导入。');historicalOwners.set(key,cid);}
    for(const table of ['messages','messageVariants'] as const)await eachBackupRow(source,table,async a=>own(table,a.id,a.conversationId),c.signal);
    await eachBackupRow(source,'pathNodes',async a=>{own('messages',a.messageId,a.conversationId);if(a.variantId)own('messageVariants',a.variantId,a.conversationId);},c.signal);
    await eachBackupRow(source,'conversationSnapshots',async a=>{for(const m of a.messages)own('messages',m.id,a.conversationId);for(const v of a.variants)own('messageVariants',v.id,a.conversationId);},c.signal);
    if(!options.story&&incoming.characters)warnings.push('未选择剧情范围，不导入角色、聊天、世界及世界书。');
    if(options.story&&incoming.characters===0)warnings.push('备份中的角色数量为0，与总记录数无关；覆盖剧情范围将移除当前角色。');
    const maps=new Map<BackupTable,Map<string,string>>(backupTables.map(t=>[t,new Map()]));
    const ns=await sha(utf8(checked.report.backupId));
    const fresh=async(t:BackupTable,id:string)=>'import-'+(await sha(utf8(`${ns}:${t}:${id}`))).slice(0,48);
    const map=async(t:BackupTable,id:any):Promise<any>=>{if(!id)return id;const m=maps.get(t)!;if(m.has(id))return m.get(id);const value=options.mode==='merge'?await fresh(t,id):id;m.set(id,value);return value;};
    let conflicts=0,duplicates=0,bytes=0,changed=0;const credentialChanges={added:0,replaced:0,removed:0,kept:0,names:[] as string[]};
    const localConfigs=await result.table('apiConfigs').toArray();let validDefault:string|undefined;for(const a of localConfigs){if(a.isDefault&&usableApi(a,(await result.table('apiCredentials').get(a.id))?.apiKey??''))validDefault=a.id;}
    for(const table of backupTables)await eachBackupRow(source,table,async row=>{const id=row[table==='apiCredentials'?'configId':'id'];const existing=await result.table(table).get(id);if(existing){if(!await equal(table,row,existing))conflicts++;}maps.get(table)!.set(id,options.mode==='merge'?(await equal(table,row,existing)?id:await fresh(table,id)):id);},c.signal);
    // Assets are immutable uploads: dedup by content, not filename or timestamps.
    const resources=new Map<string,string>();await eachBackupRow(result,'assets',async a=>{resources.set(await sha(utf8(a.data)),a.id);},c.signal);
    await eachBackupRow(source,'assets',async a=>{if(a.type==='chat-image'){
      // A chat image ID is also a bubble/reference identity. Equal bytes must not
      // collapse distinct occurrences inside one message into an ambiguous target.
      const old=await result.table('assets').get(a.id);maps.get('assets')!.set(a.id,old&&(old.type!=='chat-image'||old.data!==a.data)?await fresh('assets',a.id):a.id);return;
    }const hash=await sha(utf8(a.data));let id=resources.get(hash);if(!id){const old=await result.table('assets').get(a.id);id=old?await fresh('assets',a.id):a.id;resources.set(hash,id!);}maps.get('assets')!.set(a.id,id!);},c.signal);
    function safeApiConfig(row:any){
      if(options.keys!=='none')return row;
      const redactions:Parameters<typeof sanitizeConfig>[1]=[];const safe=sanitizeConfig(row,redactions);
      if(redactions.length)warnings.push('未选择导入密钥：API 配置中的敏感字段或URL参数已脱敏，请在API设置中核对。');return safe;
    }
    // Configuration and Key always follow the same remapped endpoint identity.
    // Explicit API-range replacement is separate from safe default merge. Keep only
    // keys whose endpoint identity still matches; deletion of all other API records
    // is visible in the preview and the final confirmation.
    if(options.api&&options.apiReplace&&options.mode==='overwrite'){
      const retained:any[]=[];
      for(const a of localConfigs){const original=await source.table('apiConfigs').get(a.id),next=original?safeApiConfig(original):undefined,key=await result.table('apiCredentials').get(a.id);if(key?.apiKey){if(next&&next.provider===a.provider&&next.baseUrl===a.baseUrl)retained.push(key);else credentialChanges.removed++;}}
      await result.table('apiCredentials').clear();await result.table('apiConfigs').clear();
      for(const a of retained){const config=await source.table('apiConfigs').get(a.configId);await result.table('apiConfigs').put(safeApiConfig(config));await result.table('apiCredentials').put(a);}
      validDefault=validDefault&&await result.table('apiConfigs').get(validDefault)?validDefault:undefined;
      warnings.push('已选择替换 API 范围：不在备份内的当前 API 配置及不匹配的密钥将被删除。');
    }
    if(options.api)await eachBackupRow(source,'apiConfigs',async original=>{const a=safeApiConfig(original),old=await result.table('apiConfigs').get(a.id);const canonical=await fresh('apiConfigs',a.id);const imported=await result.table('apiConfigs').get(canonical);let id=a.id;
      if(old&&!await equal('apiConfigs',a,old)&&options.apiConflict!=='keep'&&!(options.apiReplace&&options.mode==='overwrite')){if(imported){const x={...a,id:canonical,isDefault:imported.isDefault};ensure(await equal('apiConfigs',x,imported),'先前导入的 API 副本已修改，请保留当前或使用新备份，未覆盖。');}id=canonical;}
      maps.get('apiConfigs')!.set(a.id,id);
    },c.signal);
    else await eachBackupRow(source,'apiConfigs',async a=>{maps.get('apiConfigs')!.set(a.id,a.id);},c.signal);
    const graph=options.story&&!(options.mode==='merge'&&options.conflicts==='skip'&&conflicts>0);
    if(options.story&&!graph)warnings.push('按所选策略保留当前：本次剧情内容整组跳过，避免跳过单条后断链。');
    async function eachOwned(table:BackupTable,cid:string,visit:(r:any)=>Promise<void>){
      for(const id of await source.table(table).where('conversationId').equals(cid).primaryKeys()){checkAbort(c.signal);await visit(await source.table(table).get(id));}
    }
    if(graph&&options.mode==='merge'){
      // An independently changed conversation must never be appended to an existing
      // (character,mode,world) scope. Clone its character when that unique scope collides.
      const force=new Set<string>();
      await eachBackupRow(source,'characters',async a=>{const transformed={...a,avatar:await map('assets',a.avatar),apiConfigId:await map('apiConfigs',a.apiConfigId),worldId:await map('worlds',a.worldId)};for(const k of ['avatar','apiConfigId','worldId'])if(!(k in a))delete transformed[k];if(maps.get('characters')!.get(a.id)===a.id&&!await equal('characters',transformed,await result.table('characters').get(a.id)))force.add(a.id);},c.signal);
      await eachBackupRow(source,'conversations',async conv=>{
        let identical=await equal('conversations',conv,await result.table('conversations').get(conv.id));
        for(const table of ownedTables)await eachOwned(table,conv.id,async r=>{if(!await equal(table,r,await result.table(table).get(r.id)))identical=false;});
        if(await map('characters',conv.characterId)!==conv.characterId||await map('worlds',conv.worldId)!==conv.worldId||await map('apiConfigs',conv.apiConfigId)!==conv.apiConfigId)identical=false;
        if(!identical){maps.get('conversations')!.set(conv.id,await fresh('conversations',conv.id));for(const table of ownedTables)await eachOwned(table,conv.id,async r=>{maps.get(table)!.set(r.id,await fresh(table,r.id));});
          const scope=JSON.stringify([await map('characters',conv.characterId),conv.mode,conv.mode==='world'?await map('worlds',conv.worldId):'']);if(await result.table('conversations').where('scopeKey').equals(scope).count())force.add(conv.characterId);
        }
      },c.signal);
      await eachBackupRow(source,'worldProfiles',async p=>{const x=await result.table('worldProfiles').where('[worldId+characterId]').equals([await map('worlds',p.worldId),await map('characters',p.characterId)]).first();if(x&&!await equal('worldProfiles',p,x))force.add(p.characterId);},c.signal);
      for(const id of force)maps.get('characters')!.set(id,await fresh('characters',id));
      await eachBackupRow(source,'conversations',async conv=>{if(force.has(conv.characterId)){maps.get('conversations')!.set(conv.id,await fresh('conversations',conv.id));for(const table of ownedTables)await eachOwned(table,conv.id,async r=>{maps.get(table)!.set(r.id,await fresh(table,r.id));});}},c.signal);
    }
    async function message(m:any){const r={...m,id:await map('messages',m.id),conversationId:await map('conversations',m.conversationId)};if(m.attachments)r.attachments=await Promise.all(m.attachments.map(async(a:any)=>({...a,assetId:await map('assets',a.assetId)})));if(m.activeVariantId)r.activeVariantId=await map('messageVariants',m.activeVariantId);if(m.bubbleDeletion)r.bubbleDeletion={...m.bubbleDeletion,variantId:await map('messageVariants',m.bubbleDeletion.variantId),images:await Promise.all(m.bubbleDeletion.images.map((id:string)=>map('assets',id)))};if(m.replyTo){const q=m.replyTo;r.replyTo={...q,conversationId:await map('conversations',q.conversationId),timelineId:await map('timelines',q.timelineId),messageId:await map('messages',q.messageId),variantId:await map('messageVariants',q.variantId),part:q.part.kind==='image'?{...q.part,assetId:await map('assets',q.part.assetId)}:q.part};}for(const k of ['regeneratedFrom','editedFrom'])if(m[k]&&maps.get('messages')!.has(m[k]))r[k]=await map('messages',m[k]);return r;}
    async function transform(table:BackupTable,a:any){const r:any={...a,id:await map(table,a.id)};
      for(const [key,t] of [['worldId','worlds'],['characterId','characters'],['conversationId','conversations'],['messageId','messages'],['variantId','messageVariants'],['activeTimelineId','timelines'],['parentTimelineId','timelines'],['headNodeId','pathNodes'],['forkNodeId','pathNodes'],['parentNodeId','pathNodes'],['lorebookId','lorebooks'],['timelineId','timelines'],['apiConfigId','apiConfigs']] as [string,BackupTable][])if(a[key])r[key]=await map(t,a[key]);
      if(a.avatar)r.avatar=await map('assets',a.avatar);
      if(table==='conversations'){r.scopeKey=JSON.stringify([r.characterId,r.mode,r.mode==='world'?r.worldId:'']);if(a.chatSettings?.background?.kind==='image')r.chatSettings={...a.chatSettings,background:{...a.chatSettings.background,assetId:await map('assets',a.chatSettings.background.assetId)}};}
      if(table==='conversations'&&a.imageDrafts)r.imageDrafts=Object.fromEntries(await Promise.all(Object.entries(a.imageDrafts).map(async([key,draft]:[string,any])=>[key?await map('timelines',key):'',{...draft,assetIds:await Promise.all(draft.assetIds.map((id:string)=>map('assets',id)))}])));
      if(table==='characters'&&options.mode==='merge'&&r.id!==a.id&&a.dailyFriendship){r.dailyFriendship=structuredClone(a.dailyFriendship);if(r.dailyFriendship.deletion){const old=r.dailyFriendship.deletion.id;const next=await fresh('characters','deletion:'+old);r.dailyFriendship.deletion.id=next;if(r.dailyFriendship.application){r.dailyFriendship.application.deletionId=next;r.dailyFriendship.application.id=await fresh('characters','application:'+r.dailyFriendship.application.id);}}}
      if(table==='messages')return message(a);
      if(table==='lorebooks'){if(options.mode==='merge'&&a.global&&a.enabled)warnings.push('包含已启用全局世界书：按原作用范围可影响所有聊天，请在世界书管理中核对。');r.worldIds=await Promise.all(a.worldIds.map((id:string)=>map('worlds',id)));}
      if(table==='timelines')r.spaceId=r.worldId?`world:${r.worldId}`:'daily';
      if(table==='pathNodes'){r.message=await message(a.message);r.fingerprint=await messageFingerprint(r.message);}
      if(table==='conversationSnapshots'){r.messages=await Promise.all(a.messages.map(message));r.variants=await Promise.all(a.variants.map((v:any)=>transform('messageVariants',v)));}
      return r;
    }
    async function put(table:BackupTable,row:any){checkAbort(c.signal);const id=row[table==='apiCredentials'?'configId':'id'],existing=await result.table(table).get(id);if(table==='assets'&&existing?.data===row.data){duplicates++;return;}if(await equal(table,row,existing)){duplicates++;return;}
      if(options.mode==='merge'&&existing&&table!=='themes'&&table!=='apiCredentials'&&table!=='apiConfigs')ensure(false,'导入副本已被修改或存在无法安全处理的冲突；请保留当前或改用覆盖模式，不会静默覆盖。');
      const encoded=await rowBytes(table,row);bytes+=encoded.length;ensure(bytes<=64*1024*1024,'导入变更超过64 MiB安全上限，未写入当前手机。');await result.table(table).put(row);changed++;
    }
    if(graph){if(options.mode==='overwrite')for(const table of storyTables)await result.table(table).clear();
      for(const table of storyTables)await eachBackupRow(source,table,async a=>{let r=await transform(table,a);if(options.mode==='merge'&&['worldProfiles','lorebooks','loreEntries'].includes(table)&&r.id===a.id&&!await equal(table,r,await result.table(table).get(r.id))){r.id=await fresh(table,a.id);maps.get(table)!.set(a.id,r.id);}await put(table,r);},c.signal);
    }
    // Import resources without deleting still-referenced local uploads.
    if(graph||options.desktop||options.identities)await eachBackupRow(source,'assets',async a=>{await put('assets',{...a,id:await map('assets',a.id)});},c.signal);
    if(options.api){await eachBackupRow(source,'apiConfigs',async original=>{const a=safeApiConfig(original),id=await map('apiConfigs',a.id),existing=await result.table('apiConfigs').get(id);if(existing&&options.apiConflict==='keep'&&!(options.apiReplace&&options.mode==='overwrite'))return;await put('apiConfigs',{...a,id,isDefault:existing?.isDefault??(current.apiConfigs?false:a.isDefault)});},c.signal);
      if(options.keys!=='none')await eachBackupRow(source,'apiCredentials',async a=>{const id=await map('apiConfigs',a.configId),old=await result.table('apiCredentials').get(id),config=await result.table('apiConfigs').get(id),original=await source.table('apiConfigs').get(a.configId);
        if(!a.apiKey){warnings.push('备份中的空凭据已跳过，不覆盖当前密钥。');credentialChanges.kept++;return;}
        if(config.provider!==original.provider||config.baseUrl!==original.baseUrl){warnings.push('保留当前 API 地址时跳过不同地址的备份凭据，避免密钥发给错误服务器。');credentialChanges.kept++;return;}
        if(!old?.apiKey||options.keys==='replace'){if(old?.apiKey===a.apiKey){credentialChanges.kept++;return;}await put('apiCredentials',{...a,configId:id});if(old?.apiKey)credentialChanges.replaced++;else credentialChanges.added++;credentialChanges.names.push(config.name);}else credentialChanges.kept++;
      },c.signal);
      const sourceDefault=(await source.table('apiConfigs').toArray()).filter(a=>a.isDefault).sort((a,b)=>a.id<b.id?-1:1)[0];
      const chosen=validDefault??(sourceDefault?await map('apiConfigs',sourceDefault.id):undefined);
      if(chosen)for(const a of await result.table('apiConfigs').toArray())if(a.isDefault!==(a.id===chosen)){await result.table('apiConfigs').update(a.id,{isDefault:a.id===chosen});changed++;}
    }
    // If API data was deliberately excluded, no imported binding may become dangling.
    for(const t of ['characters','conversations'] as const)await eachBackupRow(result,t,async a=>{if(a.apiConfigId)ensure(await result.table('apiConfigs').get(a.apiConfigId),'角色或会话依赖未选择导入的 API 配置，请选择 API 范围或保留完整关联。');},c.signal);
    const sourceTheme=await source.table('themes').get('global'),localTheme=await result.table('themes').get('global');
    let theme={...(localTheme??defaultTheme)};
    if(options.desktop&&options.mode==='overwrite'){
      await result.table('pages').clear();await result.table('items').clear();for(const table of ['pages','items'] as const)await eachBackupRow(source,table,async a=>{const row={...a};if(row.icon)row.icon=await map('assets',row.icon);await put(table,row);},c.signal);
      if(sourceTheme){theme={...sourceTheme,userIdentities:localTheme?.userIdentities};if(theme.wallpaper)theme.wallpaper=await map('assets',theme.wallpaper);}
      await eachBackupRow(source,'themes',async a=>{if(a.id!=='global'){const row={...a};if(row.wallpaper)row.wallpaper=await map('assets',row.wallpaper);if(row.worldId)row.worldId=await map('worlds',row.worldId);if(options.identities&&row.userIdentities){const ids:Record<string,any>=Object.create(null);for(const [k,v] of Object.entries(row.userIdentities) as [string,any][]){const key=k.startsWith('world:')?'world:'+await map('worlds',k.slice(6)):k;ensure(key==='daily'||key.startsWith('world:'),'用户身份作用域不受支持，未省略未知资料。');ids[key]={...v,...(v.avatar?{avatar:await map('assets',v.avatar)}:{})};}row.userIdentities=ids;}else row.userIdentities=(await result.table('themes').get(row.id))?.userIdentities;await put('themes',row);}},c.signal);
    }else if(options.desktop&&options.mode==='merge')warnings.push('合并保留当前桌面、布局和外观；若要替换外观，请另选覆盖恢复及外观范围。');
    if(options.identities&&sourceTheme?.userIdentities){let identities:Record<string,any>=options.mode==='overwrite'?Object.create(null):{...theme.userIdentities};
      for(const [space,original] of Object.entries(sourceTheme.userIdentities) as [string,any][]){const key=space.startsWith('world:')?`world:${await map('worlds',space.slice(6))}`:space;
        ensure(key==='daily'||(key.startsWith('world:')&&await result.table('worlds').get(key.slice(6))),'用户身份依赖未导入的世界，请同时导入剧情内容。');const identity={...original};if(identity.avatar)identity.avatar=await map('assets',identity.avatar);
        if(options.mode==='merge'&&identities[key]&&options.identityConflict==='keep'){if(JSON.stringify(identities[key])!==JSON.stringify(identity))warnings.push(`${key==='daily'?'日常':'世界'}身份冲突：按选择保留当前身份。`);continue;}identities[key]=identity;
      }theme.userIdentities=identities;
    }
    await put('themes',theme);
    // Preserved identity scopes must still refer to retained worlds.
    for(const [space,identity] of Object.entries(theme.userIdentities??{})){if(space.startsWith('world:'))ensure(await result.table('worlds').get(space.slice(6)),'保留的身份依赖将被删除的世界，请同时选择身份范围或使用合并。');if((identity as any).avatar)ensure(await result.table('assets').get((identity as any).avatar),'身份头像资源缺失，未导入。');}
    if(!await result.table('pages').count()){await result.table('pages').add({id:'page-1',order:0});if(!await result.table('items').count())await result.table('items').bulkAdd(defaultItems());}
    await validate(result,c.signal);const after=await digest(result,c.signal),counts=await dataCounts(result);
    const added={...counts};for(const k of Object.keys(added) as (keyof DataCounts)[])added[k]=Math.max(0,counts[k]-current[k]);
    const plan:ImportPlan={preview:{formatVersion:checked.report.schemaVersion===5?1:2,schemaVersion:checked.report.schemaVersion,createdAt:checked.report.snapshotCompletedAt,credentials:checked.report.credentials,incoming,current,result:counts,added,duplicates,conflicts,changed,bytes,warnings:[...new Set(warnings)],options:{...options},credentialChanges,manifestDigest:checked.report.manifestDigest},dispose:async()=>{if(plans.has(plan)){plans.delete(plan);result.close();await Dexie.delete(name);}}};
    plans.set(plan,{database:result,targetName:database.name,before,after});target=undefined;return plan;
  }finally{clearTimeout(timeout);document.removeEventListener('visibilitychange',hidden);signal?.removeEventListener('abort',abort);await cleanup?.dispose();if(target){target.close();await Dexie.delete(name);}}
}

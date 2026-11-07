/** Actual old manifest codecs/table sets, not a renamed v7 archive. */
export async function legacyStoryBackup(version:5|6){
 const {db}=await import('/src/store');const f=await import('/src/backupFormat');const schemas=f.schemasForVersion(version),tables:any={},resources:any[]=[];let text='';
 for(const [name,schema] of Object.entries(schemas)){const rows=name==='apiCredentials'?[]:await db.table(name).orderBy(':id').toArray();let digest=await f.tableSeed(name);for(const row of rows){const bytes=await f.rowBytes(name as any,row);text+=new TextDecoder().decode(bytes)+'\n';digest=await f.nextDigest(digest,bytes);if(name==='assets')resources.push({id:row.id,bytes:f.utf8(row.data).length,digest:await f.sha(f.utf8(row.data))});}tables[name]={schema,count:rows.length,sourceCount:await db.table(name).count(),digest};}
 const bytes=f.utf8(text),id=crypto.randomUUID(),now=new Date().toISOString(),part={index:0,name:`${id}.part-0001.cphone`,bytes:bytes.length,digest:await f.sha(bytes)};
 const manifest={format:'claudia-phone-backup',version:version===5?1:2,codec:1,backupId:id,schemaVersion:version,nativeVersion:version*10,createdAt:now,snapshotCompletedAt:now,coordination:'isolated fixture',tables,resources,parts:[part],credentials:'excluded',redactions:[]};
 return [new File([JSON.stringify(manifest)],`${id}.manifest.json`),new File([bytes],part.name)];
}

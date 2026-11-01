import {db,usePhone} from '../src/store';
import {getConversation} from '../src/chatService';
import {messageTables,snapshotPath} from '../src/messageOperations';
import {commitTimelineProjection} from '../src/timelines';
import {newBook,newEntry} from '../src/loreTypes';
import {saveIdentity} from '../src/userIdentity';
export async function richBackupData(){
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await db.assets.put({id:'rich-avatar',type:'avatar',data:png,createdAt:1});
  await db.worlds.put({id:'rich-world',name:'用户自定义世界',description:'用户背景',createdAt:1});
  await db.characters.bulkPut([{id:'rich-a',name:'恢复角色甲',persona:'完整设定',avatar:'rich-avatar',apiConfigId:'rich-api'},{id:'rich-b',name:'恢复角色乙',persona:'',dailyFriendship:{status:'friend'}}]);
  await db.worldProfiles.put({id:'rich-profile',characterId:'rich-a',worldId:'rich-world',setting:'世界特定设定'});
  await db.apiConfigs.put({id:'rich-api',name:'迁移配置',provider:'openai',baseUrl:'https://fixture.invalid/v1',model:'fixture-model',temperature:.8,maxTokens:32,enabled:true,isDefault:true,createdAt:1,updatedAt:1});
  await db.apiCredentials.put({configId:'rich-api',apiKey:'synthetic-rich-fixture-key'});
  await saveIdentity('daily',{name:'日常身份',bio:'用户简介',customSetting:'用户设定',avatar:'rich-avatar'});
  await saveIdentity('world:rich-world',{name:'世界身份',bio:'世界简介',customSetting:'世界代入资料',avatar:'rich-avatar'});
  for(const [cid,world] of [['rich-a',undefined],['rich-b',undefined],['rich-a','rich-world']] as const){const c=await getConversation(cid,world);await db.transaction('rw',messageTables(),async()=>{
    const user={id:'u-'+c.id,conversationId:c.id,role:'user' as const,content:world?'世界中的问题':'日常中的问题',createdAt:1},variant={id:'v-'+c.id,messageId:'a-'+c.id,conversationId:c.id,content:world?'世界回答':'日常回答',source:'generated' as const,createdAt:2};
    await db.messages.bulkPut([user,{id:variant.messageId,conversationId:c.id,role:'assistant',content:variant.content,activeVariantId:variant.id,createdAt:2}]);await db.messageVariants.put(variant);await db.messageRevisions.put({id:'r-'+c.id,messageId:variant.messageId,conversationId:c.id,variantId:variant.id,content:'修订前',createdAt:1});await commitTimelineProjection(c.id,'append');await snapshotPath(c.id,'edit');
  });}
  const book={...newBook('用户世界书'),id:'rich-book',global:false,worldIds:['rich-world']};await db.lorebooks.put(book);await db.loreEntries.put({...newEntry(book.id),id:'rich-entry',content:'设定内容',primaryKeys:['关键词']});await usePhone.getState().reload();
}

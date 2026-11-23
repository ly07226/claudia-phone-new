import React,{useEffect,useState} from 'react';
import {usePhone} from './store';
import {listGroupRooms,listGroupMessages,saveGroupRoom} from './groupChatStore';
import {sendGroupTurn,retryGroupTurn} from './groupChatService';
import type {GroupRoom,GroupMessage} from './groupChatCore';
import {MessageAvatar} from './MessageUI';
import {AttachmentMenu,MessageImages,StoredImage} from './ImageAttachments';
import {prepareImage,imageLimits,attachmentError} from './imageAttachments';
import {db} from './store';
import './GroupChat.css';
export function GroupChat({initialRoomId='',onCreated}:{initialRoomId?:string;onCreated?:(room:GroupRoom)=>void}){
 const characters=usePhone(s=>s.characters);
 const [rooms,setRooms]=useState<GroupRoom[]>([]);
 const [roomId,setRoomId]=useState(initialRoomId);
 const [messages,setMessages]=useState<GroupMessage[]>([]);
 const [title,setTitle]=useState('');
 const [members,setMembers]=useState<string[]>([]);
 const [draft,setDraft]=useState('');
 const assets=usePhone(s=>s.assets);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [retryAvailable,setRetryAvailable]=useState(false);
 const [imageIds,setImageIds]=useState<string[]>([]);
 const [processingImages,setProcessingImages]=useState(false);
 useEffect(()=>{void listGroupRooms().then(setRooms).catch(e=>setError(String(e)))},[]);
 useEffect(()=>setRoomId(initialRoomId),[initialRoomId]);
 useEffect(()=>{setRetryAvailable(false);setImageIds([])},[roomId]);
 useEffect(()=>{let alive=true;if(!roomId){setMessages([]);return;}void listGroupMessages(roomId).then(rows=>{if(alive){setMessages(rows);setRetryAvailable(rows.at(-1)?.authorId==='player')}}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false}},[roomId]);
 const room=rooms.find(r=>r.id===roomId);
 async function create(){
  if(members.length<2){setError('请至少选择两个角色');return}
  const now=Date.now(),newRoom:GroupRoom={id:crypto.randomUUID(),title:title.trim()||'新群聊',memberIds:members,createdAt:now,updatedAt:now};
  try{await saveGroupRoom(newRoom);setRooms(old=>[newRoom,...old]);setRoomId(newRoom.id);onCreated?.(newRoom);setTitle('');setMembers([]);setError('')}catch(e){setError(e instanceof Error?e.message:'创建失败')}
 }
 async function send(){
  if(!room||(!draft.trim()&&!imageIds.length)||busy||processingImages)return;
  const text=draft.trim(),selectedImages=[...imageIds],targetRoomId=room.id;
  let savedThisTurn=false;
  setBusy(true);setError('');setRetryAvailable(false);
  try{
   await sendGroupTurn(room,text,selectedImages,()=>{
    savedThisTurn=true;
    setDraft('');setImageIds([]);
    void listGroupMessages(targetRoomId).then(setMessages).catch(()=>{});
   });
  }catch(e){
   if(savedThisTurn){
    setRetryAvailable(true);
    setError((e instanceof Error?e.message:'生成失败')+'；消息已保存，可重试角色回复');
   }else{
    setError(e instanceof Error?e.message:'发送失败，消息未确认保存');
   }
  }finally{
   try{
    const latest=await listGroupMessages(targetRoomId);
    setMessages(latest);
    setRetryAvailable(latest.at(-1)?.authorId==='player');
   }catch(e){setError(e instanceof Error?e.message:'读取群聊记录失败')}
   setBusy(false);
  }
 }
 async function chooseImages(files:FileList|null,scope:string){if(!files?.length||processingImages)return;if(scope!==roomId){setError('群聊已切换，请重新选择图片');return}if(imageIds.length+files.length>imageLimits.count){setError('每条消息最多3张图片');return}setProcessingImages(true);setError('');try{const prepared:Awaited<ReturnType<typeof prepareImage>>[]=[];for(const file of Array.from(files))prepared.push(await prepareImage(file));if(scope!==roomId)throw Error('群聊已切换，请重新选择图片');await db.assets.bulkAdd(prepared.map(({notice,...asset})=>asset));setImageIds(old=>[...old,...prepared.map(a=>a.id)]);const notices=prepared.map(a=>a.notice).filter(Boolean);if(notices.length)setError(notices.join(' '))}catch(e){setError(attachmentError(e))}finally{setProcessingImages(false)}}
 async function retry(){if(!room||busy||!retryAvailable)return;setBusy(true);setError('');try{await retryGroupTurn(room);setRetryAvailable(false)}catch(e){setError(e instanceof Error?e.message:'重试失败')}finally{try{setMessages(await listGroupMessages(room.id))}catch{}setBusy(false)}}
 const name=(id:string)=>id==='player'?'我':characters.find(c=>c.id===id)?.name||'已移除角色';
 return <main className="group-chat">
  <header className="gc-title"><h2>{room?room.title:'创建群聊'}</h2>{room?<p>{room.memberIds.length} 位角色 · 独立聊天记录</p>:<p>选择参与群聊的角色</p>}</header>
  {!room?<section className="gc-create"><h3>选择群成员</h3><p className="gc-selection-note">已选择 {members.length} 位角色（至少 2 位）</p><input aria-label="群名称" placeholder="群名称" value={title} onChange={e=>setTitle(e.target.value)}/><div className="gc-members">{characters.map(c=><label key={c.id} className="gc-member-option"><MessageAvatar src={assets.find(a=>a.id===c.avatar)?.data} name={c.name}/><span>{c.name}</span><input type="checkbox" checked={members.includes(c.id)} onChange={e=>{const checked=e.target.checked;setMembers(old=>checked?[...old,c.id]:old.filter(x=>x!==c.id))}}/></label>)}</div><button disabled={members.length<2} onClick={()=>void create()}>创建群聊（{members.length}）</button></section>:<><section className="gc-members-line">{room.memberIds.map(name).join(' · ')}</section><section className="gc-history">{messages.map(m=><article key={m.id} className={m.authorId==='player'?'mine':''}>{m.authorId!=='player'&&<MessageAvatar src={assets.find(a=>a.id===characters.find(c=>c.id===m.authorId)?.avatar)?.data} name={name(m.authorId)}/>}<div className="gc-message-body"><strong>{name(m.authorId)}</strong>{m.text&&<p>{m.text}</p>}{m.imageIds?.length?<MessageImages ids={m.imageIds}/>:null}</div></article>)}{busy&&<p>角色正在回复…</p>}</section><div className="gc-compose-area">{imageIds.length>0&&<div className="gc-image-draft">{imageIds.map(id=><div key={id}><StoredImage id={id}/><button type="button" aria-label="移除图片" onClick={()=>setImageIds(old=>old.filter(x=>x!==id))}>×</button></div>)}</div>}<div className="gc-compose"><AttachmentMenu disabled={!room||busy} processing={processingImages} scope={roomId} onChoose={(files,scope)=>void chooseImages(files,scope)} onOpenChange={()=>{}}/><input aria-label="群聊消息" placeholder="发消息到群聊…" value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)void send()}}/><button disabled={busy||processingImages||(!draft.trim()&&!imageIds.length)} onClick={()=>void send()}>发送</button></div></div></>}
  {error&&<p role="alert" className="gc-error">{error}</p>}{retryAvailable&&room&&<button type="button" className="gc-retry" disabled={busy} onClick={()=>void retry()}>重试角色回复（不重复发送消息）</button>}
 </main>;
}

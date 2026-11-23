import React,{useEffect,useState} from 'react';
import {usePhone} from './store';
import {listGroupRooms,listGroupMessages,saveGroupRoom} from './groupChatStore';
import {sendGroupTurn} from './groupChatService';
import type {GroupRoom,GroupMessage} from './groupChatCore';
import {MessageAvatar} from './MessageUI';
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
 useEffect(()=>{void listGroupRooms().then(setRooms).catch(e=>setError(String(e)))},[]);
 useEffect(()=>setRoomId(initialRoomId),[initialRoomId]);
 useEffect(()=>{let alive=true;if(!roomId){setMessages([]);return;}void listGroupMessages(roomId).then(rows=>{if(alive)setMessages(rows)}).catch(e=>{if(alive)setError(String(e))});return()=>{alive=false}},[roomId]);
 const room=rooms.find(r=>r.id===roomId);
 async function create(){
  if(members.length<2){setError('请至少选择两个角色');return}
  const now=Date.now(),newRoom:GroupRoom={id:crypto.randomUUID(),title:title.trim()||'新群聊',memberIds:members,createdAt:now,updatedAt:now};
  try{await saveGroupRoom(newRoom);setRooms(old=>[newRoom,...old]);setRoomId(newRoom.id);onCreated?.(newRoom);setTitle('');setMembers([]);setError('')}catch(e){setError(e instanceof Error?e.message:'创建失败')}
 }
 async function send(){
  if(!room||!draft.trim()||busy)return;
  const text=draft.trim();setDraft('');setBusy(true);setError('');
  try{await sendGroupTurn(room,text)}catch(e){setError((e instanceof Error?e.message:'生成失败')+'；你的消息已保存，可继续发送')}finally{
   try{setMessages(await listGroupMessages(room.id))}catch{}
   setBusy(false);
  }
 }
 const name=(id:string)=>id==='player'?'我':characters.find(c=>c.id===id)?.name||'已移除角色';
 return <main className="group-chat">
  <header className="gc-title"><h2>{room?room.title:'创建群聊'}</h2>{room?<p>{room.memberIds.length} 位角色 · 独立聊天记录</p>:<p>选择参与群聊的角色</p>}</header>
  {!room?<section className="gc-create"><h3>选择群成员</h3><p className="gc-selection-note">已选择 {members.length} 位角色（至少 2 位）</p><input aria-label="群名称" placeholder="群名称" value={title} onChange={e=>setTitle(e.target.value)}/><div className="gc-members">{characters.map(c=><label key={c.id} className="gc-member-option"><MessageAvatar src={assets.find(a=>a.id===c.avatar)?.data} name={c.name}/><span>{c.name}</span><input type="checkbox" checked={members.includes(c.id)} onChange={e=>{const checked=e.target.checked;setMembers(old=>checked?[...old,c.id]:old.filter(x=>x!==c.id))}}/></label>)}</div><button disabled={members.length<2} onClick={()=>void create()}>创建群聊（{members.length}）</button></section>:<><section className="gc-members-line">{room.memberIds.map(name).join(' · ')}</section><section className="gc-history">{messages.map(m=><article key={m.id} className={m.authorId==='player'?'mine':''}>{m.authorId!=='player'&&<MessageAvatar src={assets.find(a=>a.id===characters.find(c=>c.id===m.authorId)?.avatar)?.data} name={name(m.authorId)}/>}<div className="gc-message-body"><strong>{name(m.authorId)}</strong><p>{m.text}</p></div></article>)}{busy&&<p>角色正在回复…</p>}</section><div className="gc-compose"><input aria-label="群聊消息" placeholder="发消息到群聊…" value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)void send()}}/><button disabled={busy||!draft.trim()} onClick={()=>void send()}>发送</button></div></>}
  {error&&<p role="alert" className="gc-error">{error}</p>}
 </main>;
}

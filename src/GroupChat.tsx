import React,{useEffect,useState} from 'react';
import {usePhone} from './store';
import {listGroupRooms,listGroupMessages,saveGroupRoom} from './groupChatStore';
import {sendGroupTurn} from './groupChatService';
import type {GroupRoom,GroupMessage} from './groupChatCore';
import './GroupChat.css';
export function GroupChat({initialRoomId='',onCreated}:{initialRoomId?:string;onCreated?:(room:GroupRoom)=>void}){
 const characters=usePhone(s=>s.characters);
 const [rooms,setRooms]=useState<GroupRoom[]>([]);
 const [roomId,setRoomId]=useState(initialRoomId);
 const [messages,setMessages]=useState<GroupMessage[]>([]);
 const [title,setTitle]=useState('');
 const [members,setMembers]=useState<string[]>([]);
 const [draft,setDraft]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{void listGroupRooms().then(setRooms).catch(e=>setError(String(e)))},[]);
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
  <header><h2>群聊</h2><p>独立群聊 · 角色之间友好互动</p></header>
  <nav className="gc-rooms">{rooms.map(r=><button key={r.id} className={roomId===r.id?'selected':''} onClick={()=>setRoomId(r.id)}>{r.title}</button>)}</nav>
  {!room?<section className="gc-create"><h3>创建群聊</h3><input aria-label="群名称" placeholder="群名称" value={title} onChange={e=>setTitle(e.target.value)}/><div className="gc-members">{characters.map(c=><label key={c.id}><input type="checkbox" checked={members.includes(c.id)} onChange={e=>setMembers(old=>e.target.checked?[...old,c.id]:old.filter(x=>x!==c.id))}/>{c.name}</label>)}</div><button onClick={()=>void create()}>创建群聊</button></section>:<><section className="gc-members-line">{room.memberIds.map(name).join(' · ')}</section><section className="gc-history">{messages.map(m=><article key={m.id} className={m.authorId==='player'?'mine':''}><strong>{name(m.authorId)}</strong><p>{m.text}</p></article>)}{busy&&<p>角色正在回复…</p>}</section><div className="gc-compose"><input aria-label="群聊消息" placeholder="发消息到群聊…" value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void send()}}/><button disabled={busy||!draft.trim()} onClick={()=>void send()}>发送</button></div></>}
  {error&&<p role="alert" className="gc-error">{error}</p>}
 </main>;
}

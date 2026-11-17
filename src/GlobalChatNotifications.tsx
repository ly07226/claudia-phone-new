import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {liveQuery} from 'dexie';
import {db} from './store';
import {subscribeChatMessages,type SavedChatMessage} from './chatMessageEvents';
import {isTargetChatVisible,openSavedChat} from './chatNotificationNavigation';
import {audioKeepAliveEnabled} from './AudioKeepAliveSettings';
import {localReplyNotificationsEnabled} from './PushNotificationSettings';
import './globalChatNotifications.css';
type Banner=SavedChatMessage&{name:string;avatar?:string};
/** Application root lifetime, independent of phone page and world remounts. */
export function GlobalChatNotifications(){
 const [queue,setQueue]=useState<Banner[]>([]),[current,setCurrent]=useState<Banner>(),[enabled,setEnabled]=useState(true);
 const enabledRef=useRef(true),seen=useRef(new Set<string>()),serial=useRef(Promise.resolve()),touch=useRef<number|undefined>(undefined),swiped=useRef(false);
 useEffect(()=>{const sub=liveQuery(()=>db.themes.get('global')).subscribe({next:t=>{const on=t?.chatMessageBanners!==false;enabledRef.current=on;setEnabled(on);if(!on){setQueue([]);setCurrent(undefined);}},error:()=>{}});return()=>sub.unsubscribe();},[]);
 useEffect(()=>{
  let alive=true;
  const stop=subscribeChatMessages(event=>{
   if(seen.current.has(event.messageId))return;seen.current.add(event.messageId);
   // A bounded cache contains only identifiers; no chat text or credentials in storage.
   if(seen.current.size>2000)seen.current.delete(seen.current.values().next().value!);
   serial.current=serial.current.then(async()=>{
    if(!alive||!enabledRef.current||isTargetChatVisible(event))return;
    const [c,m,character]=await Promise.all([db.conversations.get(event.conversationId),db.messages.get(event.messageId),db.characters.get(event.characterId)]);
    if(!alive||!c||!m||!character||c.chatSettings?.muted||m.archived||m.replyInterruption||m.role!=='assistant'||m.conversationId!==c.id||c.characterId!==event.characterId||c.worldId!==event.worldId||!enabledRef.current||isTargetChatVisible(event))return;
    // Use the committed text, not an independently generated notification.
    const avatar=character.avatar?(await db.assets.get(character.avatar))?.data:undefined;
    if(!alive)return;
    if(document.hidden){
     if(audioKeepAliveEnabled()&&localReplyNotificationsEnabled()&&typeof Notification!=='undefined'&&Notification.permission==='granted'&&'serviceWorker'in navigator){const sw=await navigator.serviceWorker.getRegistration();await sw?.showNotification(character.name,{body:event.preview,tag:'claudia-reply-'+event.messageId,icon:'/apple-icon.png?v=2',data:{conversationId:c.id,messageId:m.id}});}
     return;
    }
    setQueue(q=>[...q,{...event,name:character.name,avatar}].slice(-20));
   }).catch(()=>{});
  });return()=>{alive=false;stop();};
 },[]);
 useEffect(()=>{if(current||!queue.length)return;const [next,...rest]=queue;setQueue(rest);if(!isTargetChatVisible(next))setCurrent(next);},[current,queue]);
 useEffect(()=>{if(!current)return;const sync=()=>{if(isTargetChatVisible(current))setCurrent(undefined);};window.addEventListener('claudia:chat-visible',sync);return()=>window.removeEventListener('claudia:chat-visible',sync);},[current]);
 useEffect(()=>{if(!current)return;const timer=setTimeout(()=>setCurrent(undefined),3000);return()=>clearTimeout(timer);},[current]);
 if(!enabled||!current)return null;
 return createPortal(<div className="global-chat-banner-layer" aria-live="polite"><button className="global-chat-banner claudia-proactive-toast" aria-label={current.name+'发来新消息，点击打开聊天'} onTouchStart={e=>{swiped.current=false;touch.current=e.touches[0]?.clientY;}} onTouchEnd={e=>{if(touch.current!==undefined&&e.changedTouches[0]?.clientY<touch.current-24){swiped.current=true;setCurrent(undefined);touch.current=undefined;}}} onClick={()=>{if(swiped.current){swiped.current=false;return;}const target=current;setCurrent(undefined);void openSavedChat(target).catch(()=>{});}}><span className="global-chat-avatar">{current.avatar?<img src={current.avatar} alt=""/>:current.name.slice(0,1)}</span><span className="global-chat-text"><span><strong>{current.name}</strong><time>{new Date(current.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></span><span className="global-chat-preview">{current.preview||'[图片]'}</span></span></button></div>,document.body);
}

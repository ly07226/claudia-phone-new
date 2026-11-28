import {useCallback,useLayoutEffect,useRef,useSyncExternalStore,type TextareaHTMLAttributes,type ButtonHTMLAttributes,type Ref} from 'react';

/** A composer-local external store. Draft changes notify only the native input
 * and send control; Chat and its history never subscribe to keystrokes. */
export function createChatDraft(){
 let value='';
 const listeners=new Set<()=>void>();
 return {
  get:()=>value,
  set:(next:string)=>{if(next===value)return;value=next;for(const notify of listeners)notify();},
  subscribe:(notify:()=>void)=>{listeners.add(notify);return()=>{listeners.delete(notify);};},
 };
}
export type ChatDraft=ReturnType<typeof createChatDraft>;
export function useChatDraft(){
 const ref=useRef<ChatDraft|null>(null);
 if(!ref.current)ref.current=createChatDraft();
 return ref.current;
}
export function ChatDraftInput({draft,inputRef,onDraft,...props}:Omit<TextareaHTMLAttributes<HTMLTextAreaElement>,'value'|'defaultValue'|'onChange'> & {draft:ChatDraft;inputRef:Ref<HTMLTextAreaElement>;onDraft?:(value:string)=>void}){
 const value=useSyncExternalStore(draft.subscribe,draft.get,draft.get);
 const native=useRef<HTMLTextAreaElement|null>(null);
 useLayoutEffect(()=>{native.current?.dispatchEvent(new Event('chat-draft-change'));},[value]);
 const attach=useCallback((el:HTMLTextAreaElement|null)=>{native.current=el;if(typeof inputRef==='function')return inputRef(el);if(inputRef)inputRef.current=el;},[inputRef]);
 return <textarea {...props} ref={attach} value={value} onChange={e=>{draft.set(e.target.value);onDraft?.(e.target.value);}}/>;
}
export function ChatDraftSend({draft,blocked,hasImages,...props}:ButtonHTMLAttributes<HTMLButtonElement> & {draft:ChatDraft;blocked:boolean;hasImages:boolean}){
 const value=useSyncExternalStore(draft.subscribe,draft.get,draft.get);
 return <button {...props} disabled={blocked||(!value.trim()&&!hasImages)}/>;
}

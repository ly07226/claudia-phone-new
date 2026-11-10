import {useSyncExternalStore} from 'react';
import {describeReplyFailure,type ReplyFailureDetails} from './replyFailure';
import {changeChatHub} from './chatHubStore';
import type {ChatHubData} from './chatHubTypes';
export type SocialFailureKind='publish'|'comment-send'|'post'|'comment'|'reply';
export interface SocialFailure {id:string;kind:SocialFailureKind;createdAt:number;postId?:string;parentId?:string;characterId?:string;details:ReplyFailureDetails}
export const socialFailureLabel=(kind:SocialFailureKind)=>kind==='publish'?'发布失败':kind==='comment-send'?'回复失败':'生成失败';
const listeners=new Set<()=>void>();
let state:{failures:SocialFailure[];toast?:{id:string;label:string;at:number}}={failures:[]};
const emit=()=>listeners.forEach(f=>f());
export function useSocialFailures(){return useSyncExternalStore(f=>{listeners.add(f);return()=>{listeners.delete(f);};},()=>state,()=>state);}
export function makeSocialFailure(error:unknown,input:Omit<SocialFailure,'details'|'createdAt'>):SocialFailure{return {...input,createdAt:Date.now(),details:describeReplyFailure(error)};}
export function putSocialFailure(h:ChatHubData,f:SocialFailure){h.failures=[...(h.failures??[]).filter(x=>x.id!==f.id),f];}
/** Local fallback keeps failed writes discoverable even when IndexedDB itself rejects the write. */
export function announceSocialFailure(f:SocialFailure){state={failures:[...state.failures.filter(x=>x.id!==f.id),f],toast:{id:f.id+':'+f.createdAt,label:socialFailureLabel(f.kind),at:f.createdAt}};emit();}
export async function recordSocialFailure(f:SocialFailure){announceSocialFailure(f);await changeChatHub(h=>putSocialFailure(h,f)).catch(()=>{/* Storage failure: retain the in-memory operation record and original draft. */});}
export async function resolveSocialFailure(id:string){state={...state,failures:state.failures.filter(x=>x.id!==id)};emit();await changeChatHub(h=>{h.failures=h.failures?.filter(x=>x.id!==id);}).catch(()=>{});}

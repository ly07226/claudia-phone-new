import {useLayoutEffect} from 'react';
import {create} from 'zustand';
import {usePhone} from './store';
import {useSpaces} from './spaces';

interface PageFrame {app:string|null;editing:boolean;scrollTop:number}
interface Navigation {scope:string;current:PageFrame|null;parents:PageFrame[];restore:PageFrame|null}
const desktop:PageFrame={app:null,editing:false,scrollTop:0};
// Transient UI history only. Refresh retains the existing desktop startup; no
// database, localStorage, settings, identity or chat state is written here.
const useNavigation=create<Navigation>(()=>({scope:'',current:null,parents:[],restore:null}));
const same=(a:PageFrame|null,b:PageFrame)=>!!a&&a.app===b.app&&a.editing===b.editing;
function scrollTop(){return document.querySelector<HTMLElement>('.phone>.app-panel>.app-scroll')?.scrollTop??0;}
// Existing links elsewhere still use usePhone.set. Observe only route fields so
// they also acquire their real parent; going home clears stale history.
const stop=usePhone.subscribe((next,previous)=>{
 if(next.activeApp===previous.activeApp&&next.editing===previous.editing)return;
 const target:PageFrame={app:next.activeApp,editing:next.editing,scrollTop:0},navigation=useNavigation.getState();
 if(same(navigation.current,target))return; // managed push/back already recorded it
 const scope=useSpaces.getState().space?.spaceId??'';
 if(!target.app&&!target.editing){useNavigation.setState({scope,current:target,parents:[],restore:null});return;}
 const from:PageFrame={app:previous.activeApp,editing:previous.editing,scrollTop:scrollTop()};
 const parents=navigation.scope===scope&&same(navigation.current,from)?navigation.parents:[];
 useNavigation.setState({scope,current:target,parents:[...parents,from].slice(-20),restore:null});
});
if(import.meta.hot)import.meta.hot.dispose(stop);
function context(){
 const phone=usePhone.getState(),scope=useSpaces.getState().space?.spaceId??'';
 const actual:PageFrame={app:phone.activeApp,editing:phone.editing,scrollTop:scrollTop()};
 const navigation=useNavigation.getState();
 // Unmanaged legacy links, home/space changes and refresh must never reuse a
 // stale parent from another page or World.
 const parents=navigation.scope===scope&&same(navigation.current,actual)?navigation.parents:[];
 return {scope,actual,parents};
}
function push(next:PageFrame){
 const {scope,actual,parents}=context();if(same(actual,next))return;
 const previous=actual.app===null&&!actual.editing?[]:parents;
 useNavigation.setState({scope,current:next,parents:[...previous,actual].slice(-20),restore:null});
 usePhone.getState().set({activeApp:next.app,editing:next.editing});
}
export function openPhoneApp(app:string){push({app,editing:false,scrollTop:0});}
export function editPhoneDesktop(){push({app:null,editing:true,scrollTop:0});}
export function backPhonePage(){
 const {scope,parents}=context(),target=parents.at(-1)??desktop;
 useNavigation.setState({scope,current:target,parents:parents.slice(0,-1),restore:target});
 usePhone.getState().set({activeApp:target.app,editing:target.editing});
}
export function usePhonePageNavigation(){
 const navigation=useNavigation(),app=usePhone(s=>s.activeApp),editing=usePhone(s=>s.editing),scope=useSpaces(s=>s.space?.spaceId??'');
 const actual={app,editing,scrollTop:0};
 const parent=navigation.scope===scope&&same(navigation.current,actual)?navigation.parents.at(-1):undefined;
 useLayoutEffect(()=>{
  if(navigation.scope!==scope||!navigation.restore||!same(navigation.current,actual))return;
  const scroll=document.querySelector<HTMLElement>('.phone>.app-panel>.app-scroll');
  if(scroll)scroll.scrollTop=navigation.restore.scrollTop;
  useNavigation.setState({restore:null});
 },[app,editing,scope,navigation.restore]);
 return {back:backPhonePage,parentName:parent?.editing?'桌面编辑':parent?.app??'桌面'};
}

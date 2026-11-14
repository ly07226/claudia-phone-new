import {useEffect} from 'react';
import {db} from './store';
import {cloudConfigured,hasCloudIdentity} from './cloudIdentity';
import {importBackgroundReplies} from './backgroundReplyImport';

/** Foreground reconciliation only. The service worker never opens IndexedDB or
 * generates AI text. A background executor must persist replies before push. */
export function BackgroundReplyReconciler(){
 useEffect(()=>{
  if(!cloudConfigured())return;
  let disposed=false,working=false;
  const reconcile=async()=>{
   if(disposed||working||document.visibilityState!=='visible'||!hasCloudIdentity())return;
   working=true;
   try{
    const rows=await db.conversations.toArray();
    for(const conversation of rows){
     if(disposed||document.visibilityState!=='visible')break;
     try{await importBackgroundReplies(conversation.id);}
     catch{/* Network errors do not block ordinary local chat; retry on next foreground pass. */}
    }
   }finally{working=false;}
  };
  const onResume=()=>{if(document.visibilityState==='visible')void reconcile();};
  void reconcile();
  document.addEventListener('visibilitychange',onResume);
  window.addEventListener('pageshow',onResume);
  window.addEventListener('focus',onResume);
  const timer=window.setInterval(()=>{void reconcile();},60000);
  return()=>{disposed=true;window.clearInterval(timer);
   document.removeEventListener('visibilitychange',onResume);
   window.removeEventListener('pageshow',onResume);
   window.removeEventListener('focus',onResume);
  };
 },[]);
 return null;
}

import {db} from './store';
import {enqueueAutomation} from './automationQueue';
import {privateNotesMetadata} from './privateNotesArchive';
import {generatePrivateNote} from './privateNotesGeneration';
import {lifeInterval} from './characterLifeGeneration';
import {lifeKey} from './characterLife';
import {isDailyFriend} from './chatRelationships';
/** Independent from the life app and from mounting PrivateNotes. One owner per pass. */
export function installPrivateNotesScheduler(){
 let stopped=false,running=false,cursor=0;
 const check=async()=>{
  if(stopped||running||document.hidden||!navigator.onLine)return;
  running=true;
  try{
   const metadata=await privateNotesMetadata();
   const roles=(await db.characters.toArray()).filter(isDailyFriend).sort((a,b)=>a.id.localeCompare(b.id));
   if(!roles.length)return;
   const owner=roles[cursor++%roles.length].id;
   const life=await db.themes.get(lifeKey(owner)) as any;
   // Do not acquire the notes owner lease merely to inspect eligibility while
   // a due life advance is starting. Otherwise a no-op note check can suppress
   // the only reopen life pass. Disabled/failed/cooling life does not gate notes.
   const state=life?.characterLife,now=Date.now();
   const lifeRunning=state?.attempt?.status==='running'&&now-state.attempt.at<180000;
   const lifeDue=state?.enabled&&state.ordinaryAllowed!==false&&now-(state.lastAdvancedAt??0)>=lifeInterval&&!(state.attempt?.status==='failed'&&now-state.attempt.at<lifeInterval);
   if(lifeRunning||lifeDue)return;
   const records=await db.themes.where(':id').startsWith('private-notes-record:'+encodeURIComponent(owner)+':').count();
   if(!records&&!metadata.notes[owner]?.length&&!life?.characterLife?.enabled)return;
   // Both generators share the existing per-role owner. Queue the dream only
   // after the diary check releases it; parallel admission silently drops one.
   void enqueueAutomation('notes:'+owner,()=>stopped||document.hidden?Promise.resolve(null):generatePrivateNote(owner)).then(()=>{
    if(stopped||document.hidden||metadata.schedule?.dreamEnabled!==true)return;
    void enqueueAutomation('dream:'+owner,()=>stopped||document.hidden?Promise.resolve(null):generatePrivateNote(owner,false,'梦境'));
   });
  }finally{running=false;}
 };
 const wake=()=>{void check().catch(()=>{})};
 const timer=setInterval(wake,60000);
 window.addEventListener('online',wake);window.addEventListener('pageshow',wake);document.addEventListener('visibilitychange',wake);wake();
 return()=>{stopped=true;clearInterval(timer);window.removeEventListener('online',wake);window.removeEventListener('pageshow',wake);document.removeEventListener('visibilitychange',wake)};
}

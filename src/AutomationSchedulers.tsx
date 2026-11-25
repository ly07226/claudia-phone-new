import {useEffect} from 'react';
import {usePhone} from './store';
import {useSpaces} from './spaces';
import {installMemorySummaryScheduler} from './memorySummaryScheduler';
import {installCharacterLifeScheduler} from './characterLifeScheduler';
import {installPrivateNotesScheduler} from './privateNotesScheduler';
import {ChatHubScheduler} from './ChatHubScheduler';
import {MemoryCalendarScheduler} from './MemoryCalendarScheduler';
import {ProactiveScheduler} from './ProactiveScheduler';
/** Lives beside the phone router, not inside any application or desktop view. */
export function AutomationSchedulers(){
 const ready=usePhone(s=>s.ready),inPhone=useSpaces(s=>!!s.space);
 useEffect(()=>{if(!ready)return;const releases=[installMemorySummaryScheduler(),installCharacterLifeScheduler(),installPrivateNotesScheduler()];return()=>{for(const stop of releases)stop();}},[ready]);
 if(!ready)return null;
 return <><ChatHubScheduler/><MemoryCalendarScheduler showNotice={inPhone}/><ProactiveScheduler/></>;
}

import {useEffect} from 'react';
import {useSpaces} from './spaces';
import {runSocialSchedule} from './socialGeneration';
export function ChatHubScheduler(){const route=useSpaces(s=>s.route);useEffect(()=>{if(route.screen!=='phone'||route.spaceId!=='daily')return;const check=()=>void runSocialSchedule();check();const timer=setInterval(check,30000);document.addEventListener('visibilitychange',check);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',check);};},[route]);return null;}

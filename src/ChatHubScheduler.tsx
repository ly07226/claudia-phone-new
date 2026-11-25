import {enqueueAutomation} from './automationQueue';
import {useEffect} from 'react';
import {runSocialSchedule} from './socialGeneration';
export function ChatHubScheduler(){useEffect(()=>{let disposed=false;const check=()=>{if(!disposed&&!document.hidden&&navigator.onLine)void enqueueAutomation('social',()=>disposed?Promise.resolve():runSocialSchedule());};check();const timer=setInterval(check,30000);document.addEventListener('visibilitychange',check);return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',check);};},[]);return null;}

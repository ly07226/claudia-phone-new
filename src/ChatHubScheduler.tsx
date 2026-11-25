import {enqueueAutomation} from './automationQueue';
import {useEffect} from 'react';
import {runSocialSchedule} from './socialGeneration';
export function ChatHubScheduler(){useEffect(()=>{let disposed=false;const check=()=>{if(!disposed&&!document.hidden&&navigator.onLine)void enqueueAutomation('social',()=>disposed?Promise.resolve():runSocialSchedule(Date.now(),()=>!disposed));};check();const timer=setInterval(check,30000);document.addEventListener('visibilitychange',check);window.addEventListener('online',check);window.addEventListener('pageshow',check);return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',check);window.removeEventListener('online',check);window.removeEventListener('pageshow',check);};},[]);return null;}

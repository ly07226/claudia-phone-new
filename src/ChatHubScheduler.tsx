import {enqueueAutomation} from './automationQueue';
import {useEffect} from 'react';
import {runSocialSchedule} from './socialGeneration';
export function ChatHubScheduler(){useEffect(()=>{const check=()=>{if(!document.hidden&&navigator.onLine)void enqueueAutomation('social',runSocialSchedule);};check();const timer=setInterval(check,30000);document.addEventListener('visibilitychange',check);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',check);};},[]);return null;}

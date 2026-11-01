import {useEffect,useState} from 'react';

/** Presentation only. An absent key means history, which is always shown in full. */
export function useBubbleReveal(total:number,playbackKey?:string){
  const [progress,setProgress]=useState({key:playbackKey,count:1});
  useEffect(()=>{
    if(!playbackKey||total<=1)return;
    let count=1;
    setProgress({key:playbackKey,count});
    const timer=setInterval(()=>{
      count++;
      setProgress({key:playbackKey,count});
      if(count>=total)clearInterval(timer);
    },350);
    return()=>clearInterval(timer);
  },[playbackKey,total]);
  return !playbackKey ? total : Math.min(total,progress.key===playbackKey?progress.count:1);
}

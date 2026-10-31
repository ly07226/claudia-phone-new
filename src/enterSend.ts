/** Safari may emit Enter just after compositionend, with isComposing=false. */
export function createEnterSendGuard(now = () => performance.now()) {
  let composing=false, endedAt=-Infinity;
  return {
    start(){composing=true;endedAt=-Infinity;},
    end(){composing=false;endedAt=now();},
    up(key:string){if(key==='Enter')endedAt=-Infinity;},
    reset(){composing=false;endedAt=-Infinity;},
    key(event:{key:string;shiftKey?:boolean;isComposing?:boolean;keyCode?:number;repeat?:boolean}):'send'|'compose'|'block'|'normal' {
      if(event.key!=='Enter')return 'normal';
      if(composing||event.isComposing||event.keyCode===229)return 'compose';
      if(event.shiftKey)return 'normal';
      // Bounded fallback: missing mobile keyup must never leave sending locked.
      if(now()-endedAt<80||event.repeat)return 'block';
      return 'send';
    }
  };
}

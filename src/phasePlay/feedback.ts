/** Owns only this app's audio. No remote audio, background playback or global handlers. */
export class PhaseFeedback {
 private context:AudioContext|undefined;
 async unlock(){const Audio=window.AudioContext??(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Audio)return false;try{this.context??=new Audio();await this.context.resume();return this.context.state==='running';}catch{return false;}}
 pulse(sound:boolean,volume:number,vibration:boolean){
  if(sound&&this.context?.state==='running'){try{const c=this.context,o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=660;g.gain.setValueAtTime(Math.max(0,volume)*.15,c.currentTime);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.05);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.06);}catch{/* Unsupported audio cannot stop the timer. */}}
  if(vibration&&typeof navigator.vibrate==='function'){try{navigator.vibrate(15);}catch{/* iOS normally offers no vibration API. */}}
 }
 stop(){if(typeof navigator.vibrate==='function')try{navigator.vibrate(0);}catch{}void this.context?.suspend().catch(()=>{});}
 dispose(){this.stop();void this.context?.close().catch(()=>{});this.context=undefined;}
}

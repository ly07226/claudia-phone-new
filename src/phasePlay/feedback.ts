/** Owns only this app's audio. No remote audio, background playback or global handlers. */
export class PhaseFeedback {
 private epoch=0;
 private wanted=false;
 private oscillators=new Set<OscillatorNode>();
 private context:AudioContext|undefined;
 async unlock(){
  const epoch=++this.epoch;this.wanted=true;const Audio=window.AudioContext??(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Audio)return false;
  try{const context=this.context??=new Audio();await context.resume();if(epoch!==this.epoch){if(!this.wanted&&context.state!=='closed')await context.suspend();return false;}return context.state==='running';}catch{return false;}
 }
 pulse(sound:boolean,volume:number,vibration:boolean){
  if(sound&&this.context?.state==='running'){try{const c=this.context,o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=660;g.gain.setValueAtTime(Math.max(0,volume)*.15,c.currentTime);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.05);o.connect(g);g.connect(c.destination);this.oscillators.add(o);o.onended=()=>this.oscillators.delete(o);o.start();o.stop(c.currentTime+.06);}catch{/* Unsupported audio cannot stop the timer. */}}
  if(vibration&&typeof navigator.vibrate==='function'){try{navigator.vibrate(15);}catch{/* iOS normally offers no vibration API. */}}
 }
 stop(){this.epoch++;this.wanted=false;for(const o of this.oscillators)try{o.stop();}catch{}this.oscillators.clear();if(typeof navigator.vibrate==='function')try{navigator.vibrate(0);}catch{}void this.context?.suspend().catch(()=>{});}
 dispose(){this.stop();void this.context?.close().catch(()=>{});this.context=undefined;}
}

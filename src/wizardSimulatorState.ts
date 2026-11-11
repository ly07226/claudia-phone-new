/** Generic, deterministic state transitions. No story-specific fields or hidden NPC facts. */
export type SimulatorValue=string|number|boolean;
export type SimulatorState=Record<string,SimulatorValue>;
export type SimulatorStateChange={key:string;op:'set'|'increment'|'remove';value?:SimulatorValue};
const validKey=(key:string)=>/^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/.test(key)&&!['__proto__','prototype','constructor'].includes(key);
const validValue=(value:unknown):value is SimulatorValue=>
 typeof value==='boolean'||typeof value==='string'&&value.length<=500||
 typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e9;
export function applySimulatorChanges(previous:SimulatorState,changes:readonly SimulatorStateChange[]):SimulatorState{
 if(changes.length>40)throw Error('单回合世界状态变更超过上限。');
 const next:SimulatorState=Object.assign(Object.create(null),previous);
 for(const change of changes){
  if(!change||!validKey(change.key))throw Error('世界状态字段无效。');
  if(change.op==='remove'){if(change.value!==undefined)throw Error('删除状态不能携带数值。');delete next[change.key];continue;}
  if(!validValue(change.value))throw Error('世界状态数值无效。');
  if(change.op==='set')next[change.key]=change.value;
  else if(change.op==='increment'){
   if(typeof change.value!=='number'||typeof next[change.key]!=='number')throw Error('增量状态需要已有数字字段。');
   const value=(next[change.key] as number)+change.value;
   if(!validValue(value))throw Error('世界状态增量越界。');
   next[change.key]=value;
  }else throw Error('未知世界状态操作。');
 }
 if(Object.keys(next).length>200)throw Error('世界状态字段超过上限。');
 return next;
}

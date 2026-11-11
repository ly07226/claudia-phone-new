/** Generic, deterministic state transitions. No story-specific fields or hidden NPC facts. */
export type SimulatorValue=string|number|boolean;
export type SimulatorState=Record<string,SimulatorValue>;
export type SimulatorStateChange={key:string;op:'set'|'increment'|'remove';value?:SimulatorValue};
const validKey=(key:string)=>/^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/.test(key)&&!['__proto__','prototype','constructor'].includes(key);
const validValue=(value:unknown):value is SimulatorValue=>
 typeof value==='boolean'||typeof value==='string'&&value.length<=500||
 typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e9;
export function applySimulatorChanges(previous:SimulatorState,changes:readonly SimulatorStateChange[]):SimulatorState{
 validateSimulatorChanges(changes);
 const next:SimulatorState=Object.create(null);
 // Treat restored/foreign snapshots as untrusted: never copy prototype keys or invalid values.
 if(!previous||typeof previous!=='object'||Array.isArray(previous))throw Error('已有世界状态结构无效。');
 for(const [key,value] of Object.entries(previous)){
  if(!validKey(key)||!validValue(value))throw Error('已有世界状态包含无效字段。');
  next[key]=value;
 }
 if(Object.keys(next).length>200)throw Error('已有世界状态字段超过上限。');
 for(const change of changes){
  if(!change||typeof change.key!=='string'||!validKey(change.key))throw Error('世界状态字段无效。');
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

/** Reconstruct state solely from committed nodes on the active branch.
 * Discarded/regenerated branches never contribute to this projection. */
export function replaySimulatorState(path:readonly {simulatorChanges?:SimulatorStateChange[]}[]):SimulatorState{
 let state:SimulatorState=Object.create(null);
 for(const node of path)if(node.simulatorChanges!==undefined)state=applySimulatorChanges(state,node.simulatorChanges);
 return state;
}
export function validateSimulatorChanges(changes:unknown):asserts changes is SimulatorStateChange[]{
 if(!Array.isArray(changes)||changes.length>40)throw Error('世界状态变更列表无效。');
 for(const change of changes){
  if(!change||typeof change!=='object'||Array.isArray(change)||typeof change.key!=='string'||!validKey(change.key)||
    !['set','increment','remove'].includes(change.op)||
    Object.keys(change).some(k=>!['key','op','value'].includes(k)))throw Error('世界状态变更字段无效。');
  if(change.op==='remove'?change.value!==undefined:!validValue(change.value)||
    change.op==='increment'&&typeof change.value!=='number')throw Error('世界状态变更数值无效。');
 }
}

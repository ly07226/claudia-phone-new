import {applySimulatorChanges,type SimulatorState,type SimulatorStateChange,type SimulatorValue} from './wizardSimulatorState';
export interface DocumentRuntimeConfig {initial:SimulatorState;fields:Record<string,{type:'number'|'string'|'boolean';min?:number;max?:number;readOnly?:boolean}>;events:{id:string;when:{key:string;op:'eq'|'gte'|'lte';value:SimulatorValue};changes:SimulatorStateChange[]}[]}
const check=(ok:unknown)=>{if(!ok)throw Error('运行状态声明无效：请声明字段类型、初值、边界和事件条件。');};
export function validateRuntimeConfig(x:DocumentRuntimeConfig){
 check(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>['initial','fields','events'].includes(k))&&x.fields&&typeof x.fields==='object'&&!Array.isArray(x.fields)&&Array.isArray(x.events)&&x.events.length<=100);
 applySimulatorChanges(x.initial,[]);check(Object.keys(x.initial).length===Object.keys(x.fields).length);
 for(const [key,f] of Object.entries(x.fields)){check(f&&Object.keys(f).every(k=>['type','min','max','readOnly'].includes(k))&&['number','string','boolean'].includes(f.type)&&Object.hasOwn(x.initial,key)&&(f.readOnly===undefined||typeof f.readOnly==='boolean'));for(const bound of [f.min,f.max])check(bound===undefined||typeof bound==='number'&&Number.isFinite(bound));check(f.min===undefined||f.max===undefined||f.min<=f.max);}
 validateRuntimeState(x.initial,x);
 check(new Set(x.events.map(e=>e.id)).size===x.events.length);
 for(const e of x.events){check(e&&typeof e.id==='string'&&/^[a-zA-Z][\w.-]{0,79}$/.test(e.id)&&Object.keys(e).every(k=>['id','when','changes'].includes(k))&&e.when&&Object.keys(e.when).every(k=>['key','op','value'].includes(k))&&Object.hasOwn(x.fields,e.when.key)&&['eq','gte','lte'].includes(e.when.op)&&typeof e.when.value===x.fields[e.when.key].type&&(e.when.op==='eq'||typeof e.when.value==='number'));applySimulatorChanges({condition:e.when.value},[]);applySimulatorChanges(x.initial,e.changes);for(const c of e.changes)check(Object.hasOwn(x.fields,c.key)&&c.op!=='remove');}
}
export function validateRuntimeState(state:SimulatorState,c:DocumentRuntimeConfig){
 check(Object.keys(state).length===Object.keys(c.fields).length);
 for(const [key,value] of Object.entries(state)){const f=c.fields[key];check(f&&typeof value===f.type&&(typeof value!=='number'||(f.min===undefined||value>=f.min)&&(f.max===undefined||value<=f.max)));}
}
export function runtimeTurn(state:SimulatorState,changes:SimulatorStateChange[],config:DocumentRuntimeConfig,fired:Set<string>){
 for(const c of changes)check(Object.hasOwn(config.fields,c.key)&&!config.fields[c.key].readOnly&&c.op!=='remove');let result=applySimulatorChanges(state,changes);validateRuntimeState(result,config);
 for(let pass=0;pass<config.events.length;pass++){let changed=false;for(const e of config.events){const actual=result[e.when.key],match=e.when.op==='eq'?actual===e.when.value:typeof actual==='number'&&typeof e.when.value==='number'&&(e.when.op==='gte'?actual>=e.when.value:actual<=e.when.value);if(!fired.has(e.id)&&match){result=applySimulatorChanges(result,e.changes);validateRuntimeState(result,config);fired.add(e.id);changed=true;}}if(!changed)break;}
 return result;
}
export function replayDocumentState(path:readonly {simulatorChanges?:SimulatorStateChange[]}[],config:DocumentRuntimeConfig){validateRuntimeConfig(config);let state=applySimulatorChanges(config.initial,[]);const fired=new Set<string>(),history:SimulatorState[]=[state];for(const n of path){if(!n.simulatorChanges)throw Error('模拟状态节点缺少变更记录。');state=runtimeTurn(state,n.simulatorChanges,config,fired);history.push(state);}return {state,fired,history};}

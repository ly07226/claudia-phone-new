import type {ScriptConfig} from './scriptTypes';
export function validateScriptConfig(value:unknown):asserts value is ScriptConfig {
  const x=value as ScriptConfig;
  if(!x||typeof x!=='object'||Array.isArray(x)||x.version!==1||!['story','everyday'].includes(x.playMode)||typeof x.opening!=='string'||x.opening.length>6000||(x.direction!==undefined&&(typeof x.direction!=='string'||x.direction.length>4000))||!Number.isSafeInteger(x.definitionRevision)||x.definitionRevision<1)
    throw Error('剧本玩法配置无效或版本不受支持，未保存。');
  if(x.perspective!==undefined&&!['first','second','third'].includes(x.perspective))throw Error('叙事人称配置无效。');
  if(x.pace!==undefined&&!['slow','balanced','compact','custom'].includes(x.pace)||x.customPace!==undefined&&(typeof x.customPace!=='string'||x.customPace.length>1000)||x.pace==='custom'&&!x.customPace?.trim())throw Error('剧本节奏配置无效。');
  if(x.creation!==undefined&&(!x.creation||x.creation.version!==1||typeof x.creation.token!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(x.creation.token)||typeof x.creation.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(x.creation.fingerprint)))throw Error('剧本创建标识无效。');
}

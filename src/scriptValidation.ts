import type {ScriptConfig} from './scriptTypes';
export function validateScriptConfig(value:unknown):asserts value is ScriptConfig {
  const x=value as ScriptConfig;
  if(!x||typeof x!=='object'||Array.isArray(x)||x.version!==1||!['story','everyday'].includes(x.playMode)||typeof x.opening!=='string'||x.opening.length>6000||(x.direction!==undefined&&(typeof x.direction!=='string'||x.direction.length>4000))||!Number.isSafeInteger(x.definitionRevision)||x.definitionRevision<1)
    throw Error('剧本玩法配置无效或版本不受支持，未保存。');
}

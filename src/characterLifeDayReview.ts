import { db } from './store';
import { resolveApi } from './chatService';
import { requestReply } from './chatProvider';
import { readCharacterLife, changeCharacterLife } from './characterLife';
import { lifeSource, assertLifeSource } from './characterLifeSource';

const localDay = (at: number) => {
 const d = new Date(at);
 return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

/** Explicit request only: never spend API credits on automatic day-review refresh. */
export async function generateLifeDayReview(owner: string, day: string) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || localDay(new Date(day + 'T12:00:00').getTime()) !== day || day > localDay(Date.now())) throw Error('日期无效');
 const state = await readCharacterLife(owner);
 const records = state.events.flatMap(event =>
  (event.progress?.length ? event.progress : [{ at: event.createdAt, text: event.detail }])
   .filter(p => localDay(p.at) === day && p.text.trim() && !/^手动(暂停|恢复|结束)$/.test(p.text.trim()))
   .map(p => ({ id: event.id, title: event.title, detail: p.text, time: p.at, source: event.source ?? 'manual' }))
 ).sort((a, b) => a.time - b.time).slice(-16);
 if (!records.length) throw Error('当天没有可供总结的生活事件');
 const snapshot = JSON.stringify(records);
 const source = await lifeSource(owner);
 const { config, key } = await resolveApi(source.conversation);
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 90000);
 try {
  let interrupted = false;
  const raw = await requestReply(config, key, [
   { role: 'system', content: '你正在为角色的独立生活档案整理一天的回顾。以提供的事件记录为事实主线。允许少量符合角色人设的氛围、感受和日常细节润色，不必逐字复述；但不得编造玩家行为、双方真实共同经历、重大事件、承诺或与既有记录冲突的结果。角色卡用于语气和合理生活细节，不是共同经历的证据。用第三人称，写成一段自然、具体、克制的中文，60至180字；无须覆盖所有事件，优先选择有实际进展的事件。模拟事件不能说成玩家与角色真实共同发生。输出严格JSON：{"text":"...","usedIds":["事件id"]}。usedIds只列正文真正依据的事件ID，不要Markdown。' },
   { role: 'user', content: JSON.stringify({ day, character: source.character.name, persona: source.character.persona.slice(0, 1200), records }) }
  ], controller.signal, undefined, false, reason => { interrupted = !!reason; });
  if (interrupted) throw Error('回顾生成中断，未保存');
  let result: { text?: unknown; usedIds?: unknown };
  try { result = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw Error('回顾格式错误，未保存'); }
  const text = typeof result.text === 'string' ? result.text.trim() : '';
  const ids = Array.isArray(result.usedIds) ? result.usedIds : [];
  if (text.length < 25 || text.length > 500 || !ids.length || ids.some(id => typeof id !== 'string' || !records.some(r => r.id === id)))
   throw Error('回顾缺少有效事件依据，未保存');
  // A provenance link is useful for review but cannot prove every semantic claim.
  await db.transaction('rw', [db.themes, db.characters, db.conversations, db.messages, db.messageVariants, db.timelines, db.pathNodes], async () => {
   await assertLifeSource(source);
   await changeCharacterLife(owner, current => {
    const fresh = current.events.flatMap(e => (e.progress?.length ? e.progress : [{ at: e.createdAt, text: e.detail }]).filter(p => localDay(p.at) === day && p.text.trim() && !/^手动(暂停|恢复|结束)$/.test(p.text.trim())).map(p => ({ id: e.id, title: e.title, detail: p.text, time: p.at, source: e.source ?? 'manual' }))).sort((a,b) => a.time - b.time).slice(-16);
    if (JSON.stringify(fresh) !== snapshot) throw Error('生活记录已变化，请重新生成');
    current.dayReviews ??= {};
    current.dayReviews[day] = { text, usedIds: ids, generatedAt: Date.now(), sourceRevision: state.revision ?? 0 };
    const keys = Object.keys(current.dayReviews).sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - 45))) delete current.dayReviews[old];
   }, state.revision ?? 0);
  });
  return text;
 } finally { clearTimeout(timer); }
}

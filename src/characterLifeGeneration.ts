import { loreForConversation } from './loreEngine';
import { db } from './store';
import { resolveApi } from './chatService';
import { requestReply } from './chatProvider';
import { memoryContext } from './memoryContext';
import { lifeSource, assertLifeSource } from './characterLifeSource';
import { readCharacterLife, changeCharacterLife, archiveCompletedLifeEvents, appendLifeProgress, lifePrompt, majorLifeEvent, type LifeEvent } from './characterLife';
export const lifeInterval = 6 * 60 * 60 * 1000;
export const affectionRule = '对玩家的感情底色保持喜欢、珍惜和在意；保留人设、嘴硬、嫉妒、欲望、复杂情绪，不强迫温柔、顺从、表白或和好。禁止厌恶、嫌弃、鄙视、后悔认识、想抛弃玩家或无故降低感情。不得决定玩家的言行、心理、同意或关系。';
export async function runCharacterLife(owner: string, manual = false, now = Date.now()) {
    const token = crypto.randomUUID();
    // Move only completed events; archive and active state update commit atomically.
    if ((await readCharacterLife(owner)).events.length >= 39) await archiveCompletedLifeEvents(owner, 2);
    let claimed = false;
    await db.transaction('rw', db.themes, async () => {
        const s = await readCharacterLife(owner);
        const writing = (await db.themes.get('private-notes-task:' + owner) as any)?.privateNotesTask;
        if (writing?.until > now) return;
        if (!s.ordinaryAllowed && s.ordinaryAllowed !== undefined)
            return;
        if (!manual && (!s.enabled || s.attempt?.status === 'running' && now - s.attempt.at < 180000 || s.attempt?.status === 'failed' && now - s.attempt.at < lifeInterval || now - s.lastAdvancedAt < lifeInterval))
            return;
        if (s.attempt?.status === 'running' && now - s.attempt.at < 180000)
            return;
        await changeCharacterLife(owner, s => { s.attempt = { token, status: 'running', at: now }; });
        claimed = true;
    });
    if (!claimed)
        return null;
    try {
        const s = await readCharacterLife(owner);
        now = Math.max(now, s.lastAdvancedAt);
        const source = await lifeSource(owner), { config, key } = await resolveApi(source.conversation);
        const [memory, lore] = await Promise.all([source.conversation.id ? memoryContext(source.conversation, source.tail, 1600) : Promise.resolve(''), loreForConversation(source.conversation, source.tail, 2000)]);
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 90000), hide = () => {
            // Visibility changes alone must not cancel an in-flight request.
        };
        document.addEventListener('visibilitychange', hide);
        const leave = () => controller.abort();
        window.addEventListener('pagehide', leave);
        let raw: string;
        try {
            let interrupted = false;
            raw = await requestReply(config, key, [{ role: 'system', content: ['根据角色设定、世界书、已有生活和真实时间，自然模拟角色自己的生活。角色可以主动安排工作、社交、兴趣、休息和计划，也可以思念玩家、表达复杂情绪、延续已有互动。独立生活无需聊天证据。', '涉及玩家的共同经历，以实际聊天为准；不要替玩家决定行动、心理或同意。保持角色设定和关系连续性，重大不可逆变化作为待确认提案。角色不得讨厌 user（玩家），但可以生气、不满或有其他复杂情绪。', '返回 JSON：{"focus":"当前重心","mood":"当前心情","updates":[{"id":"已有事件id","status":"ongoing或paused或done","detail":"进展"}],"events":[{"title":"事件标题","detail":"具体内容","level":"ordinary或continuing或major","actor":"self"}]}。自然推进已有事件，也可新增事件。没有变化时可以保持原状。', source.character.persona, source.character.speakingStyle ?? ''].join('\n') }, { role: 'user', content: JSON.stringify({ now, firstAdvance: !s.lastAdvancedAt, elapsedMs: s.lastAdvancedAt ? Math.max(0, now - s.lastAdvancedAt) : 0, lore: lore.entries.map(e => e.content), state: lifePrompt(s), memory, chat: source.tail.map(m => ({ role: m.role, at: m.createdAt, text: m.content.slice(0, 800) })) }) }], controller.signal, undefined, false, r => interrupted = !!r);
            if (interrupted)
                throw Error('生活推进输出中断，未保存');
        }
        finally {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', hide);
            window.removeEventListener('pagehide', leave);
        }
        const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const result = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
        if (!result || typeof result.focus !== 'string' || typeof result.mood !== 'string' || !Array.isArray(result.updates) || !Array.isArray(result.events))
            throw Error('生活推进格式无效');
        // Preserve the model's nuanced relationship language; do not discard the entire life update for keyword matches.

        await db.transaction('rw', [db.themes, db.characters, db.conversations, db.messages, db.messageVariants, db.timelines, db.pathNodes], async () => {
            await assertLifeSource(source);
            await changeCharacterLife(owner, async next => {
                if (next.attempt?.token !== token || next.revision !== s.revision || !manual && !next.enabled)
                    throw Error('生活状态已变化，未保存过期结果');

                next.focus = result.focus.slice(0, 300);
                if (result.mood !== next.mood && result.mood.trim()) {
                    next.moodHistory = [...(next.moodHistory ?? []), { at: now, mood: result.mood }].slice(-120);
                }
                next.mood = result.mood.slice(0, 200);
                for (const u of result.updates.slice(0, 3)) {
                    const e = next.events.find(e => e.id === u.id);
                    if (!e || e.status === 'done' || !['ongoing', 'paused', 'done'].includes(u.status) || typeof u.detail !== 'string' || majorLifeEvent(u.detail))
                        continue;
                    const previousProgress = e.progress?.length ? e.progress : [{ at: e.updatedAt, text: e.detail, status: 'ongoing' as const }];
                    e.status = u.status;
                    e.detail = u.detail.slice(0, 500);
                    e.updatedAt = now;
                    e.source = 'simulation';
                    e.confidence = 'simulated';
                    e.progress = previousProgress;
                    await appendLifeProgress(owner, e, { at: now, text: u.detail.slice(0, 500), status: u.status });
                }
                for (const input of result.events.slice(0, 2)) {
                    if (typeof input.title !== 'string' || !input.title.trim() || typeof input.detail !== 'string')
                        continue;
                    if ([...next.events, ...next.proposals ?? []].some(e => e.title === input.title))
                        continue;
                    const major = input.level === 'major' || majorLifeEvent(input.title), event: LifeEvent = { id: crypto.randomUUID(), title: input.title.slice(0, 120), detail: input.detail.slice(0, 500), level: major ? 'major' : input.level === 'continuing' ? 'continuing' : 'ordinary', status: 'ongoing', createdAt: now, updatedAt: now, source: 'simulation', confidence: 'simulated', progress: [{ at: now, text: input.detail.slice(0, 500), status: 'ongoing' }] };
                    if (major) {
                        next.proposals ??= [];
                        if (next.proposals.length >= 5)
                            continue;
                        next.proposals.push(event);
                    }
                    else {
                        if (next.events.length >= 40)
                            continue;
                        next.events.push(event);
                    }
                    ;
                }
                next.lastAdvancedAt = now;
                next.attempt = { token, status: 'succeeded', at: now };
            }, s.revision);
        });
        return await readCharacterLife(owner);
    }
    catch (error) {
        await db.transaction('rw', db.themes, async () => {
            const current = await readCharacterLife(owner);
            if (current.attempt?.token === token)
                await changeCharacterLife(owner, s => { s.attempt = { token, status: 'failed', at: now, error: error instanceof Error ? error.message.slice(0, 300) : '推进失败，原状态保留' }; });
        });
        throw error;
    }
}

import {recoverSummaryBatch} from './memorySummaryFormat';
import {requestAutomationReply,setAutomationPreflight,armAutomationTimeout} from './automationRequests';
import { loreForConversation } from './loreEngine';
import { db } from './store';
import { resolveAutomationApi } from './dedicatedSummaryApi';
import { requestReply } from './chatProvider';
import { memoryContext } from './memoryContext';
import { lifeSource, assertLifeSource } from './characterLifeSource';
import { readCharacterLife, lifeKey, changeCharacterLife, archiveCompletedLifeEvents, appendLifeProgress, lifePrompt, assertLifeAffection, majorLifeEvent, type LifeEvent } from './characterLife';
export const lifeInterval = 6 * 60 * 60 * 1000;
export const affectionRule = '对玩家的感情底色保持喜欢、珍惜和在意；保留人设、嘴硬、嫉妒、欲望、复杂情绪，不强迫温柔、顺从、表白或和好。禁止厌恶、嫌弃、鄙视、后悔认识、想抛弃玩家或无故降低感情。不得决定玩家的言行、心理、同意或关系。';
export async function runCharacterLife(owner: string, manual = false, now = Date.now(), admitted:()=>boolean=()=>true) {
    if(!admitted())return null;
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
        if(!manual&&s.attempt?.status==='running'&&now-s.attempt.at>=180000){await changeCharacterLife(owner,state=>{state.attempt={...state.attempt!,status:'failed',at:now,error:'上次请求中断，状态待确认；可手动恢复或等待下一周期'}});return;}
        if (!manual && (!s.enabled || s.attempt?.status === 'running' && now - s.attempt.at < 180000 || s.attempt?.status === 'failed' && now - s.attempt.at < lifeInterval || now - s.lastAdvancedAt < lifeInterval))
            return;
        if (s.attempt?.status === 'running' && now - s.attempt.at < 180000)
            return;
        await changeCharacterLife(owner, s => { s.attempt = { token, status: 'running', at: now }; });
        claimed = true;
    });
    if (!claimed)
        return null;
    // Renew only lease metadata, never the semantic life revision. A queued
    // live owner must not be mistaken for a crashed page after three minutes.
    const beat=setInterval(()=>{void db.transaction('rw',db.themes,async()=>{
        const row=await db.themes.get(lifeKey(owner)) as any;
        if(row?.characterLife?.attempt?.token===token&&row.characterLife.attempt.status==='running'){
            row.characterLife.attempt.at=Date.now();await db.themes.put(row);
        }
    }).catch(()=>{})},20000);
    let stage = '读取角色与 API';
    try {
        const s = await readCharacterLife(owner);
        now = Math.max(now, s.lastAdvancedAt);
        const source = await lifeSource(owner), { config, key } = await resolveAutomationApi(source.conversation);
        stage = '读取记忆与世界书';
        const [memory, lore] = await Promise.all([source.conversation.id ? memoryContext(source.conversation, source.tail, 1600) : Promise.resolve(''), loreForConversation(source.conversation, source.tail, 2000)]);
        const controller = new AbortController(), timer = armAutomationTimeout(controller, 150000), hide = () => {
            // Visibility changes alone must not cancel an in-flight request.
        };
        document.addEventListener('visibilitychange', hide);
        const leave = () => controller.abort();
        window.addEventListener('pagehide', leave);
        setAutomationPreflight(controller.signal,async()=>{if(!admitted())throw Error('生活调度已停止，未发送请求');await assertLifeSource(source);const current=await readCharacterLife(owner);if(current.attempt?.token!==token||current.attempt.status!=='running'||current.revision!==s.revision)throw Error('生活任务已变化，未发出过期请求')});
        let raw: string;
        stage = 'AI 请求';
        try {
            let interrupted = false;
            raw = await requestAutomationReply(config, key, [{ role: 'system', content: ['根据角色设定、世界书、已有生活和真实时间，自然模拟角色自己的生活。角色可以主动安排工作、社交、兴趣、休息和计划，也可以思念玩家、表达复杂情绪、延续已有互动。独立生活无需聊天证据。', '涉及玩家的共同经历，以实际聊天为准；不要替玩家决定行动、心理或同意。保持角色设定和关系连续性，重大不可逆变化作为待确认提案。角色不得讨厌 user（玩家），但可以生气、不满或有其他复杂情绪。', '返回 JSON：{"focus":"当前重心","mood":"当前心情","updates":[{"id":"已有事件id","status":"ongoing或paused或done","detail":"进展"}],"events":[{"title":"事件标题","detail":"具体内容","level":"ordinary或continuing或major","actor":"self"}]}。自然推进已有事件，也可新增事件。经过数小时后优先给出至少一条合理的独立生活进展或新事件；不要编造玩家行为。', source.character.persona, source.character.speakingStyle ?? ''].join('\n') }, { role: 'user', content: JSON.stringify({ now, firstAdvance: !s.lastAdvancedAt, elapsedMs: s.lastAdvancedAt ? Math.max(0, now - s.lastAdvancedAt) : 0, lore: lore.entries.map(e => e.content), state: lifePrompt(s), existingEvents: s.events.filter(e => e.status !== 'done').map(e => ({ id: e.id, title: e.title, status: e.status, detail: e.detail })), memory, chat: source.tail.map(m => ({ role: m.role, at: m.createdAt, text: m.content.slice(0, 800) })) }) }], controller.signal, undefined, true, r => interrupted = !!r);
            if (interrupted)
                throw Error('生活推进输出中断，未保存');
        }
        finally {
            timer();
            document.removeEventListener('visibilitychange', hide);
            window.removeEventListener('pagehide', leave);
        }
        stage = '解析 AI 输出';
        const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const result = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
        if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.events) && !Array.isArray(result.updates))
            throw Error('生活推进格式无效');
        result.focus = typeof result.focus === 'string' ? result.focus : s.focus;
        result.mood = typeof result.mood === 'string' ? result.mood : s.mood;
        result.updates = Array.isArray(result.updates) ? result.updates : [];
        result.events = Array.isArray(result.events) ? result.events : [];
        // Reuse the existing relationship guard (which exempts explicit denial and
        // complaints about behavior), never rewrite the model's tone.
        const descriptions=[result.focus,result.mood,...result.events.flatMap((e:any)=>[e.title,e.detail]),...result.updates.map((e:any)=>e.detail)].filter((s:unknown):s is string=>typeof s==='string');
        const sourceInput=JSON.stringify([source.tail.map(m=>({role:m.role,content:m.content}))]);
        for(const text of descriptions){
            assertLifeAffection(text);
            // Only explicit new player decisions/consent assertions need actual
            // user-source support. Ordinary self events do not require chat proof.
            for(const claim of text.match(/(?:玩家|用户)(?:已经|刚刚|决定|答应|同意)[^。！？!?\n]*/gu)??[]){
                const content=claim.replace(/^(玩家|用户)/u,'用户');
                const checked=recoverSummaryBatch(JSON.stringify({memories:[{content,type:/明天|计划|打算|准备|下周/u.test(content)?'pending':'fact'}]}),sourceInput,true);
                if(!checked.facts.length)throw Error('生活结果包含无原文依据的玩家行动或同意，未保存');
            }
        }
        if(result.events.some((e:any)=>e.actor!==undefined&&e.actor!=='self'))throw Error('自主生活事件不能替其他人决定行动，未保存');

        stage = '保存生活状态';
        // Validate the source outside the write transaction to avoid unrelated path reads aborting it.
        await assertLifeSource(source);
        await db.transaction('rw', db.themes, async () => {
            await changeCharacterLife(owner, async next => {
                if (next.attempt?.token !== token || next.revision !== s.revision || !manual && !next.enabled)
                    throw Error('生活状态已变化，未保存过期结果');

                next.focus = result.focus.slice(0, 300);
                if (result.mood !== next.mood && result.mood.trim()) {
                    next.moodHistory = [...(next.moodHistory ?? []), { at: now, mood: result.mood.slice(0, 200) }].slice(-120);
                }
                next.mood = result.mood.slice(0, 200);
                for (const u of result.updates.slice(0, 3)) {
                    if (!u || typeof u !== 'object') continue;
                    const e = next.events.find(e => e.id === u.id || e.title === u.id || e.title === u.title);
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
                    if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim() || typeof input.detail !== 'string')
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
                await changeCharacterLife(owner, s => { s.attempt = { token, status: 'failed', at: now, error: stage + '：' + (error instanceof Error ? error.message.slice(0, 260) : '推进失败，原状态保留') }; });
        });
        throw error;
    }finally{clearInterval(beat);}
}

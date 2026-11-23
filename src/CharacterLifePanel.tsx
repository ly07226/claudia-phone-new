import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { readCharacterLife, changeCharacterLife, readLifeArchive, archiveCompletedLifeEvents, readLifeProgressArchive, appendLifeProgress, type LifeProgress, type LifeEvent, type CharacterLife } from './characterLife';
import { runCharacterLife } from './characterLifeGeneration';
import { generateLifeDayReview } from './characterLifeDayReview';
export function CharacterLifePanel({ owner }: {
    owner: string;
}) {
    const [archived, setArchived] = useState<LifeEvent[]>([]);
    const [archivedProgress, setArchivedProgress] = useState<Record<string, LifeProgress[]>>({});
    const [filter, setFilter] = useState<'all' | 'ongoing' | 'done'>('all');
    const [selectedDay, setSelectedDay] = useState(() => new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0'));
    const [openEvent, setOpenEvent] = useState<string | null>(null);
    const [reviewBusy, setReviewBusy] = useState(false);
    const [reviewError, setReviewError] = useState('');
    const [state, setState] = useState<CharacterLife>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [draft, setDraft] = useState({ focus: '', mood: '', occupations: '', interests: '' });
    useEffect(() => { setState(undefined); setError(''); const sub = liveQuery(() => readCharacterLife(owner)).subscribe({ next: s => setState(s), error: () => setError('生活状态读取失败，原数据未修改，请重新打开') }); return () => sub.unsubscribe(); }, [owner]);
    useEffect(() => { const sub = liveQuery(() => readLifeArchive(owner)).subscribe({ next: setArchived, error: () => setError('历史档案读取失败，请刷新重试') }); return () => sub.unsubscribe(); }, [owner]);
    useEffect(() => { const sub = liveQuery(() => readLifeProgressArchive(owner)).subscribe({ next: setArchivedProgress, error: () => setError('历史进展读取失败，请刷新重试') }); return () => sub.unsubscribe(); }, [owner]);
    const [, refreshLease] = useState(0);
    useEffect(() => {
        const a = state?.attempt;
        if (a?.status !== 'running')
            return;
        const wait = 180000 - (Date.now() - a.at);
        if (wait <= 0)
            return;
        const timer = setTimeout(() => refreshLease(x => x + 1), wait + 5);
        return () => clearTimeout(timer);
    }, [state?.attempt?.token, state?.attempt?.status, state?.attempt?.at]);
    const change = (edit: (s: CharacterLife) => void | Promise<void>) => {
        if (!state)
            return;
        void changeCharacterLife(owner, edit, state.revision ?? 0).catch(() => setError('状态已变化或保存失败，请刷新后重试'));
    };
    const advance = async () => {
        if (!window.confirm('本次推进会调用角色已配置的 API，可能消耗额度；失败不会自动重试。是否继续？'))
            return;
        setBusy(true);
        setError('');
        try {
            if(!await runCharacterLife(owner, true))setError('该角色正在书写或推进，请稍后再试');
        }
        catch {
            setError('推进失败；原状态保留，检查 API 后可手动重试');
        }
        finally {
            setBusy(false);
        }
    };
    const dayStamp = (at: number) => { const d = new Date(at); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
    const dayMood = (state?.moodHistory ?? []).filter(m => dayStamp(m.at) <= selectedDay).at(-1)?.mood
        ?? (selectedDay === dayStamp(Date.now()) ? state?.mood : undefined);
    const dayEvents = useMemo(() => [...(state?.events ?? []), ...archived].flatMap(e => {
        const points = [...(archivedProgress[e.id] ?? []), ...(e.progress?.length ? e.progress : [{ at: e.createdAt, text: e.detail }])].filter(p => dayStamp(p.at) === selectedDay);
        return points.map(p => ({ event: e, point: p, historicalStatus: p.status ?? (e.status === 'done' && p.at < e.updatedAt ? 'ongoing' : e.status) }));
    }).sort((a, b) => a.point.at - b.point.at), [state, archived, archivedProgress, selectedDay]);
    const dayLatest = [...new Map(dayEvents.map(entry => [entry.event.id, entry])).values()];
    const storedReview = state?.dayReviews?.[selectedDay];
    const reviewValid = !!storedReview && storedReview.usedIds.every(id => dayLatest.some(e => e.event.id === id))
        && !dayEvents.some(({ point }) => point.at > storedReview.generatedAt);
    const allHistory = [...(state?.events ?? []), ...archived].flatMap(e => [...(archivedProgress[e.id] ?? []), ...(e.progress?.length ? e.progress : [{ at: e.createdAt, text: e.detail }])].map(p => ({ event: e, point: p, historicalStatus: p.status ?? e.status }))).sort((a, b) => b.point.at - a.point.at);
    const displayedEvents = dayEvents.length ? dayEvents : allHistory;
    const filtered = displayedEvents.filter(({ historicalStatus }) => filter === 'all' || (filter === 'done' ? historicalStatus === 'done' : historicalStatus === 'ongoing' || historicalStatus === 'paused'));
    const review = (() => {
        if (!dayEvents.length) return '这一天还没有已保存的生活事件。';
        const unique = dayLatest;
        return unique.slice(0, 3).map(({ event, point }) => {
            const detail = point.text.trim();
            return detail && detail !== event.title ? event.title + '：' + detail : event.title;
        }).join('；') + (unique.length > 3 ? '。其余事件可在下方时间轴查看。' : '。');
    })();
    const archiveOld = async () => { try { const count = await archiveCompletedLifeEvents(owner, 2); if (!count) setError('当前无需归档；未结束的事件不会自动移入历史'); else setError('已归档 ' + count + ' 条已完成事件'); } catch (e) { setError(e instanceof Error ? e.message : '归档失败'); } };
    const writeReview = async () => {
        if (!window.confirm('将使用当前角色 API 整理当天已有事件，可能消耗额度。是否生成？')) return;
        setReviewBusy(true); setReviewError('');
        try { await generateLifeDayReview(owner, selectedDay); }
        catch (e) { setReviewError(e instanceof Error ? e.message : '回顾生成失败，请手动重试'); }
        finally { setReviewBusy(false); }
    };
    const moveDay = (step: number) => { const d = new Date(selectedDay + 'T12:00:00'); d.setDate(d.getDate() + step); setSelectedDay(dayStamp(d.getTime())); setOpenEvent(null); setReviewError(''); };
    if (!state)
        return <section className="pn-card" role="status">{error || '正在读取生活状态…'}</section>;
    return <div className="pn-life"><details className="pn-card pn-life-controls"><summary>生活引擎设置与手动推进</summary><p>角色独立生活，与聊天记忆分开保存。</p><details><summary>运行与费用说明</summary><p>启用后仅在前台低频检查，离线只补算一次。推进及自动日记可能分别消耗现有 API 额度，不会在关闭应用后后台请求。最多40个活跃事件；已完成事件可转入历史档案，保留原始进展。每个事件最近20条进展保留在活跃状态，较早进展另存历史档案。</p></details>
 <label className="pn-life-setting">自主生活推进<input type="checkbox" checked={!!state.enabled} onChange={e => {
            const enabled = e.target.checked;
            if (enabled && !window.confirm('开启后，前台会按需调用现有角色 API 推进生活并按书写设置生成日记，可能消耗额度。是否开启？'))
                return;
            change(s => { s.enabled = enabled; if (!enabled && s.attempt?.status === 'running') s.attempt = { ...s.attempt, status: 'failed', error: '推进已关闭，未采用的结果不会写入；已发出请求可能计费' }; });
        }}/></label>
 <label className="pn-life-setting">允许普通生活事件<input type="checkbox" checked={state.ordinaryAllowed !== false} onChange={e => { const v = e.target.checked; change(s => { s.ordinaryAllowed = v; }); }}/></label><p>重大事件必须确认；提案不会自动变成事实或玩家经历。</p>
 <p>生活重心：{state.focus || '尚未设定'}<br />当前心境：{state.mood || '尚未设定'}<br />最近推进：{state.lastAdvancedAt ? new Date(state.lastAdvancedAt).toLocaleString() : '尚未推进'}</p>
 <details onToggle={e => {
            if (e.currentTarget.open)
                setDraft({ focus: state.focus, mood: state.mood, occupations: state.occupations ?? '', interests: state.interests ?? '' });
        }}><summary>管理生活重心与已确立资料</summary>{(['focus', 'mood', 'occupations', 'interests'] as const).map((field, i) => <label className="pn-life-field" key={field}>{['生活重心', '当前心境', '已确立职业', '已确立兴趣'][i]}<input maxLength={field === 'mood' ? 200 : 300} value={draft[field]} onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}/></label>)}<button className="pn-action" onClick={() => change(s => { if (draft.mood.trim() && draft.mood !== s.mood) s.moodHistory = [...(s.moodHistory ?? []), { at: Date.now(), mood: draft.mood }].slice(-120); Object.assign(s, draft); })}>保存生活资料</button></details>
 <button className="pn-action" onClick={() => void archiveOld()}>归档已完成事件</button><p>历史档案：{archived.length} 条；归档后仍可在时间轴查看。</p>
 <button className="pn-action" disabled={busy || state.ordinaryAllowed === false || state.attempt?.status === 'running' && Date.now() - state.attempt.at < 180000} onClick={() => void advance()}>{busy ? '正在推进…' : '推进一次 / 手动恢复'}</button>
 {state.attempt && <p role="status">推进状态：{state.attempt.status === 'failed' ? '失败，等待手动恢复' : state.attempt.status === 'running' ? '请求处理中；若页面曾关闭，请稍后手动恢复' : '已完成'}{state.attempt.error && ' · ' + state.attempt.error}</p>}{error && <p role="alert">{error}</p>}</details>

 <section className="pn-life-timeline" aria-label="生活时间轴">
  <header className="pn-life-timeline-head"><h3>他的生活</h3><span className="pn-mood-chip" title={dayMood || '当天没有可确认的心情记录'}>{dayMood ? '☁ ' + dayMood.slice(0, 12) : '☁ 心情未记录'}</span></header>
  <div className="pn-life-day"><button aria-label="前一天" onClick={() => moveDay(-1)}>‹</button><strong>{new Date(selectedDay + 'T12:00:00').toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</strong><button aria-label="后一天" onClick={() => moveDay(1)} disabled={selectedDay >= dayStamp(Date.now())}>›</button></div>
  <div className="pn-life-review"><div className="pn-life-review-title">☼ 当日回顾 <small>DAY NOTES</small></div><p>{(reviewValid ? storedReview!.text : review)}</p>{dayEvents.length > 0 && <button type="button" className="pn-life-review-generate" disabled={reviewBusy} onClick={() => void writeReview()}>{reviewBusy ? '正在整理…' : state.dayReviews?.[selectedDay] ? '重新整理当日回顾 · 使用 API' : 'AI 整理当日回顾 · 使用 API'}</button>}{reviewError && <p role="alert">{reviewError}</p>}<div className="pn-life-counts"><span>✓ 已结束 {dayLatest.filter(({ historicalStatus }) => historicalStatus === 'done').length}</span><span>◉ 未结束 {dayLatest.filter(({ historicalStatus }) => historicalStatus !== 'done').length}</span></div><small>AI 回顾仅基于已保存事件生成，仍可能出现不准确表达；重新整理会消耗 API 额度。</small></div>
  <div className="pn-life-timeline-title"><h3>{dayEvents.length ? '生活时间轴' : '生活时间轴 · 历史记录'}</h3><small>{filtered.length} 条记录</small></div>
  <div className="pn-life-filters">{([['all','全部'],['ongoing','进行中'],['done','已结束']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
  <div className="pn-life-trail">{filtered.length === 0 && <p className="pn-life-empty">没有符合筛选条件的记录；历史记录不会因日期筛选而删除</p>}{filtered.map(({ event, point, historicalStatus }, index) => <article className="pn-life-trail-item" key={event.id + ':' + point.at + ':' + index}><span className={'pn-life-dot ' + (historicalStatus === 'done' ? 'done' : '')}/><button className="pn-life-trail-heading" onClick={() => setOpenEvent(openEvent === event.id + ':' + point.at ? null : event.id + ':' + point.at)} aria-expanded={openEvent === event.id + ':' + point.at}><span className="pn-life-trail-meta"><time>{new Date(point.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><small>{historicalStatus === 'done' ? '已结束' : historicalStatus === 'paused' ? '已暂停' : '进行中'}</small></span><strong>{event.title}</strong></button>{openEvent === event.id + ':' + point.at && <div className="pn-life-trail-detail"><p>{point.text}</p><small>{event.source === 'simulation' ? '角色模拟生活 · 非聊天事实' : '手动确认'}</small><div className="pn-life-actions">{!archived.some(e => e.id === event.id) && event.status === 'ongoing' && <button onClick={() => change(async s => { const e = s.events.find(e => e.id === event.id)!; e.status = 'paused'; e.updatedAt = Date.now(); await appendLifeProgress(owner, e, { at: e.updatedAt, text: '手动暂停', status: 'paused' }); })}>暂停</button>}{!archived.some(e => e.id === event.id) && event.status === 'paused' && <button onClick={() => change(async s => { const e = s.events.find(e => e.id === event.id)!; e.status = 'ongoing'; e.updatedAt = Date.now(); await appendLifeProgress(owner, e, { at: e.updatedAt, text: '手动恢复', status: 'ongoing' }); })}>恢复</button>}{!archived.some(e => e.id === event.id) && event.status !== 'done' && <button onClick={() => { if (window.confirm('确认结束该事件？')) change(async s => { const e = s.events.find(e => e.id === event.id)!; e.status = 'done'; e.updatedAt = Date.now(); await appendLifeProgress(owner, e, { at: e.updatedAt, text: '手动结束', status: 'done' }); }); }}>结束</button>}{!archived.some(e => e.id === event.id) && <button onClick={() => { if (window.confirm('删除这条生活事件及全部进展？')) change(s => { s.events = s.events.filter(e => e.id !== event.id); if (s.dayReviews) for (const [day, item] of Object.entries(s.dayReviews)) if (item.usedIds.includes(event.id)) delete s.dayReviews[day]; }); }}>删除错误事件</button>}</div></div>}</article>)}</div>
 </section>
 {!!state.proposals?.length && <section><h3>重大事件提案 · 尚未发生</h3>{state.proposals.map(e => <article className="pn-card" key={e.id}><h3>{e.title}</h3><p>{e.detail}</p><button onClick={() => {
                    if (window.confirm('明确授权将此重大事件加入角色生活状态？不会改写角色卡或聊天记录。'))
                        change(s => {
                            if (s.events.length >= 40)
                                throw Error('事件容量已满');
                            s.events.push({ ...e, source: 'manual', confidence: 'confirmed', updatedAt: Date.now() });
                            s.proposals = s.proposals?.filter(p => p.id !== e.id);
                        });
                }}>确认授权事件</button><button onClick={() => change(s => { s.proposals = s.proposals?.filter(p => p.id !== e.id); })}>拒绝提案</button></article>)}</section>}
 </div>;
}

import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { readCharacterLife, changeCharacterLife, type CharacterLife } from './characterLife';
import { runCharacterLife } from './characterLifeGeneration';
export function CharacterLifePanel({ owner }: {
    owner: string;
}) {
    const [state, setState] = useState<CharacterLife>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [draft, setDraft] = useState({ focus: '', mood: '', occupations: '', interests: '' });
    useEffect(() => { setState(undefined); setError(''); const sub = liveQuery(() => readCharacterLife(owner)).subscribe({ next: s => setState(s), error: () => setError('生活状态读取失败，原数据未修改，请重新打开') }); return () => sub.unsubscribe(); }, [owner]);
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
    const change = (edit: (s: CharacterLife) => void) => {
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
    if (!state)
        return <section className="pn-card" role="status">{error || '正在读取生活状态…'}</section>;
    return <div className="pn-life"><section className="pn-card"><h3>角色自主生活</h3><p>角色独立生活，与聊天记忆分开保存。</p><details><summary>运行与费用说明</summary><p>启用后仅在前台低频检查，离线只补算一次。推进及自动日记可能分别消耗现有 API 额度，不会在关闭应用后后台请求。最多40个事件，每个事件保留最近20条进展。</p></details>
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
        }}><summary>管理生活重心与已确立资料</summary>{(['focus', 'mood', 'occupations', 'interests'] as const).map((field, i) => <label className="pn-life-field" key={field}>{['生活重心', '当前心境', '已确立职业', '已确立兴趣'][i]}<input maxLength={field === 'mood' ? 200 : 300} value={draft[field]} onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}/></label>)}<button className="pn-action" onClick={() => change(s => Object.assign(s, draft))}>保存生活资料</button></details>
 <button className="pn-action" disabled={busy || state.ordinaryAllowed === false || state.attempt?.status === 'running' && Date.now() - state.attempt.at < 180000} onClick={() => void advance()}>{busy ? '正在推进…' : '推进一次 / 手动恢复'}</button>
 {state.attempt && <p role="status">推进状态：{state.attempt.status === 'failed' ? '失败，等待手动恢复' : state.attempt.status === 'running' ? '请求处理中；若页面曾关闭，请稍后手动恢复' : '已完成'}{state.attempt.error && ' · ' + state.attempt.error}</p>}{error && <p role="alert">{error}</p>}</section>
 {(['ongoing', 'paused', 'done'] as const).map((status, i) => <section key={status}><h3 className="pn-section">{['进行中', '已暂停', '已完成'][i]}</h3>{!state.events.some(e => e.status === status) && <p>暂无事件</p>}{state.events.filter(e => e.status === status).map(event => <article className="pn-card" key={event.id}><h3>{event.title}</h3><p>{event.detail}</p><small>{event.source === 'simulation' ? '自主模拟 · 非聊天事实' : '手动确认'} · {new Date(event.createdAt).toLocaleDateString()} → {new Date(event.updatedAt).toLocaleString()}</small><details><summary>事件进展记录</summary>{(event.progress ?? []).map((p, n) => <p key={n}>{new Date(p.at).toLocaleString()} · {p.text}</p>)}</details><div className="pn-life-actions">{event.status === 'ongoing' && <button onClick={() => change(s => { const e = s.events.find(e => e.id === event.id)!; e.status = 'paused'; e.updatedAt = Date.now(); e.progress = [...(e.progress ?? []), { at: e.updatedAt, text: '手动暂停' }].slice(-20); })}>暂停事件</button>}{event.status === 'paused' && <button onClick={() => change(s => { const e = s.events.find(e => e.id === event.id)!; e.status = 'ongoing'; e.updatedAt = Date.now(); e.progress = [...(e.progress ?? []), { at: e.updatedAt, text: '手动恢复' }].slice(-20); })}>恢复事件</button>}{event.status !== 'done' && <button onClick={() => {
                        if (window.confirm('确认结束该事件？不会修改聊天记忆。'))
                            change(s => { const e = s.events.find(e => e.id === event.id)!; e.status = 'done'; e.updatedAt = Date.now(); });
                    }}>结束事件</button>}<button onClick={() => {
                    if (window.confirm('只删除当前角色的这个生活事件？'))
                        change(s => { s.events = s.events.filter(e => e.id !== event.id); });
                }}>删除错误事件</button></div></article>)}</section>)}
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

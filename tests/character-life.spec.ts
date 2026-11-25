import { test, expect, type Page } from '@playwright/test';
import { isolatedApp } from './backupBrowser';
async function seed(page: Page, chat = false) {
    await isolatedApp(page, 'life-' + crypto.randomUUID());
    await page.evaluate(async (chat) => {
        const { db, usePhone } = await import('/src/store.ts');
        for (const id of ['life-a', 'life-b'])
            await db.characters.put({ id, name: id, persona: '性格嘴硬，职业是编辑，喜欢读书。', speakingStyle: '简洁幽默' });
        await db.apiConfigs.put({ id: 'life-api', name: '模拟', provider: 'openai-compatible', baseUrl: 'https://life.test/v1', model: 'mock', maxTokens: 3000, temperature: .7, enabled: true, isDefault: true, createdAt: 1, updatedAt: 1 });
        await db.apiCredentials.put({ configId: 'life-api', apiKey: 'synthetic-only' });
        if (chat) {
            const { getConversation } = await import('/src/chatService.ts');
            for (const owner of ['life-a', 'life-b']) {
                const c = await getConversation(owner);
                await db.messages.bulkPut(Array.from({ length: 8 }, (_, i) => ({ id: owner + i, conversationId: c.id, role: i % 2 ? 'assistant' : 'user', content: i % 2 ? '今天继续看书。' : '今天看书了吗？', createdAt: Date.now() - 8000 + i * 1000 })));
            }
        }
        await usePhone.getState().reload();
    }, chat);
}
const result = (patch: object = {}) => ({ focus: '阅读', mood: '平静但有点好奇', updates: [], events: [{ title: '正在阅读一本书', detail: '读到一个有趣的问题，尚未读完。', level: 'continuing', actor: 'self' }], ...patch });
async function mock(page: Page, data = result()) { let calls = 0; await page.route('https://life.test/**', r => { calls++; return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] } }); }); return () => calls; }
test('legacy state and per-role isolation survive reload without advancing clock', async ({ page }) => { await seed(page); const r = await page.evaluate(async () => { const { db } = await import('/src/store.ts'), m = await import('/src/characterLife.ts'); await db.themes.put({ ...m.lifeRow({ version: 1, characterId: 'life-a', lastAdvancedAt: 7, focus: '旧重心', mood: '旧心境', events: [] }) } as any); await m.saveCharacterLife('life-a', { focus: '保留职业', mood: '开心', events: [] }); return { a: await m.advanceCharacterLife('life-a', Date.now()), b: await m.readCharacterLife('life-b') }; }); expect(r.a.lastAdvancedAt).toBe(7); expect(r.a.focus).toBe('保留职业'); expect(r.b.focus).toBe(''); await page.reload(); expect(await page.evaluate(async () => (await (await import('/src/characterLife.ts')).readCharacterLife('life-a')).focus)).toBe('保留职业'); });
test('disabled has zero calls; long offline interval performs one progression, never hourly catchup', async ({ page }) => { await seed(page); const calls = await mock(page); const r = await page.evaluate(async () => { const m = await import('/src/characterLife.ts'), g = await import('/src/characterLifeGeneration.ts'); const off = await g.runCharacterLife('life-a'); await m.changeCharacterLife('life-a', s => { s.enabled = true; }); await g.runCharacterLife('life-a', false, Date.now()); await g.runCharacterLife('life-a', false, Date.now()); return { off, a: await m.readCharacterLife('life-a'), b: await m.readCharacterLife('life-b') }; }); expect(calls()).toBe(1); expect(r.off).toBeNull(); expect(r.a.events).toHaveLength(1); expect(r.b.events).toHaveLength(0); });
test('continuing event advances across days by ID; mere elapsed time cannot mark it done', async ({ page }) => { await seed(page); await mock(page); const id = await page.evaluate(async () => { await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true); return (await (await import('/src/characterLife.ts')).readCharacterLife('life-a')).events[0].id; }); await page.unroute('https://life.test/**'); await mock(page, result({ events: [], updates: [{ id, status: 'ongoing', detail: '仍在阅读并记下问题。' }] })); const r = await page.evaluate(async () => { const g = await import('/src/characterLifeGeneration.ts'), m = await import('/src/characterLife.ts'); await g.runCharacterLife('life-a', true, Date.now() + 2 * 86400000); return m.readCharacterLife('life-a'); }); expect(r.events).toHaveLength(1); expect(r.events[0].id).toBe(id); expect(r.events[0].status).toBe('ongoing'); expect(r.events[0].progress).toHaveLength(2); });
test('major event is an unconfirmed proposal excluded from life prompt and chat', async ({ page }) => { await seed(page); await mock(page, result({ events: [{ title: '考虑职业变动', detail: '辞职是尚未确认的提案。', actor: 'self', level: 'major' }] })); const r = await page.evaluate(async () => { await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true); const m = await import('/src/characterLife.ts'), s = await m.readCharacterLife('life-a'); return { s, prompt: m.lifePrompt(s) }; }); expect(r.s.events).toHaveLength(0); expect(r.s.proposals).toHaveLength(1); expect(r.prompt).not.toContain('辞职'); });
for (const detail of ['我讨厌玩家，后悔认识玩家。', '玩家已经决定搬家并答应了。'])
    test('rejects unsupported hostility/player action: ' + detail, async ({ page }) => {
        await seed(page);
        await mock(page, result({ events: [{ title: '个人事件', detail, level: 'ordinary', actor: 'self' }] }));
        const r = await page.evaluate(async () => {
            try {
                await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true);
            }
            catch { }
            return (await import('/src/characterLife.ts')).readCharacterLife('life-a');
        });
        expect(r.events).toHaveLength(0);
        expect(r.lastAdvancedAt).toBe(0);
        expect(r.attempt?.status).toBe('failed');
    });
test('independent diary without any conversation saves once, dream does not consume diary progress', async ({ page }) => { await seed(page); let calls = 0, prompt = ''; await page.route('https://life.test/**', r => { calls++; prompt = r.request().postDataJSON().messages.map((m: any) => m.content).join('\n'); return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ title: '独处', body: '这是角色独处时关于阅读的主观想法，并不是玩家的经历。'.repeat(14) }) }, finish_reason: 'stop' }] } }); }); const r = await page.evaluate(async () => { const m = await import('/src/characterLife.ts'), g = await import('/src/privateNotesGeneration.ts'), a = await import('/src/privateNotesArchive.ts'); await m.changeCharacterLife('life-a', s => { s.enabled = true; s.focus = '阅读'; }); await a.saveNoteSchedule({ mode: 'interval', intervalMinutes: 60 }); await g.generatePrivateNote('life-a', true, '梦境'); await g.generatePrivateNote('life-a'); await g.generatePrivateNote('life-a'); const { db } = await import('/src/store.ts'); return { notes: await g.loadNotes('life-a'), messages: await db.messages.count(), conversations: await db.conversations.count() }; }); expect(calls).toBe(2); expect(r.notes.map(n => n.kind).sort()).toEqual(['日记', '梦境']); expect(r.messages).toBe(0); expect(r.conversations).toBe(0); expect(prompt).toContain('模拟生活事件'); expect(prompt).toContain('珍惜'); });
for (const failure of ['network', 'truncated', 'json'])
    test('failure blocks automatic paid retry, manual can recover: ' + failure, async ({ page }) => {
        await seed(page);
        let calls = 0;
        await page.route('https://life.test/**', r => {
            calls++;
            if (failure === 'network')
                return r.abort('failed');
            return r.fulfill({ json: { choices: [{ message: { content: failure === 'json' ? 'bad' : JSON.stringify(result()) }, finish_reason: failure === 'truncated' ? 'length' : 'stop' }] } });
        });
        const state = await page.evaluate(async () => {
            const m = await import('/src/characterLife.ts'), g = await import('/src/characterLifeGeneration.ts');
            await m.changeCharacterLife('life-a', s => { s.enabled = true; });
            try {
                await g.runCharacterLife('life-a');
            }
            catch { }
            await g.runCharacterLife('life-a');
            return m.readCharacterLife('life-a');
        });
        expect(calls).toBe(1);
        expect(state.attempt?.status).toBe('failed');
        expect(state.events).toHaveLength(0);
        await page.unroute('https://life.test/**');
        await mock(page);
        expect(await page.evaluate(async () => !!await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true))).toBe(true);
    });
test('two concurrent tasks only request once and manual changes reject stale output', async ({ page }) => { await seed(page); let calls = 0; await page.route('https://life.test/**', async (r) => { calls++; await page.evaluate(async () => { await (await import('/src/characterLife.ts')).changeCharacterLife('life-a', s => { s.focus = '手动优先'; }); }); return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result()) }, finish_reason: 'stop' }] } }); }); const r = await page.evaluate(async () => { const g = await import('/src/characterLifeGeneration.ts'); await Promise.allSettled([g.runCharacterLife('life-a', true), g.runCharacterLife('life-a', true)]); return (await import('/src/characterLife.ts')).readCharacterLife('life-a'); }); expect(calls).toBe(1); expect(r.focus).toBe('手动优先'); expect(r.events).toHaveLength(0); });
test('source editing while request runs rejects life result, never changes chat or memory', async ({ page }) => {
    await seed(page, true);
    await page.route('https://life.test/**', async (r) => { await page.evaluate(async () => { await (await import('/src/store.ts')).db.messages.update('life-a0', { content: '编辑后' }); }); return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result()) }, finish_reason: 'stop' }] } }); });
    const r = await page.evaluate(async () => {
        try {
            await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true);
        }
        catch { }
        const { db } = await import('/src/store.ts');
        return { s: await (await import('/src/characterLife.ts')).readCharacterLife('life-a'), messages: await db.messages.count(), memories: (await db.conversations.toArray()).map(c => c.memoryStore) };
    });
    expect(r.s.events).toHaveLength(0);
    expect(r.s.lastAdvancedAt).toBe(0);
    expect(r.messages).toBe(16);
    expect(r.memories.every(m => !m)).toBe(true);
});
for (const width of [390, 430])
    test('life UI responsive settings and pause/finish/delete, role switch ' + width, async ({ page }) => { await page.setViewportSize({ width, height: 844 }); await seed(page); await page.evaluate(async () => { const m = await import('/src/characterLife.ts'); await m.saveCharacterLife('life-a', { focus: '阅读', mood: '开心', events: [{ id: 'e', title: '持续阅读', detail: '尚未读完', status: 'ongoing', createdAt: 1, updatedAt: 2 }] }); (await import('/src/store.ts')).usePhone.getState().set({ activeApp: '手记' }); }); await page.getByLabel('当前角色', { exact: true }).selectOption('life-a'); await page.getByRole('button', { name: '生活', exact: true }).click(); await expect(page.locator('.pn-life')).toContainText('持续阅读'); await page.getByRole('button',{name:'持续阅读'}).click(); await page.getByRole('button', { name: '暂停', exact: true }).click(); await page.getByRole('button',{name:/持续阅读/}).first().click(); await expect(page.getByRole('button', { name: '恢复', exact: true })).toBeVisible(); page.on('dialog', d => d.accept()); await page.getByRole('button', { name: '结束', exact: true }).click(); await page.getByRole('button', { name: '删除错误事件', exact: true }).click(); await expect(page.locator('.pn-life')).not.toContainText('持续阅读'); await page.getByLabel('当前角色', { exact: true }).selectOption('life-b'); await expect(page.locator('.pn-life')).not.toContainText('阅读'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: '/tmp/character-life-' + width + '.png', fullPage: true }); });
test('chat reads only relevant Daily bounded simulation, excludes World, proposals and unrelated topic', async ({ page }) => { await seed(page, true); const r = await page.evaluate(async () => { const m = await import('/src/characterLife.ts'), { db } = await import('/src/store.ts'), { buildContext } = await import('/src/chatContext.ts'); await m.changeCharacterLife('life-a', s => { s.enabled = true; s.focus = '编辑工作'; s.proposals = [{ id: 'p', title: '辞职', detail: '未确认', status: 'ongoing', createdAt: 1, updatedAt: 1 }]; }); const c = (await db.conversations.where('characterId').equals('life-a').first())!; await db.messages.update('life-a7', { role: 'user', content: '今天工作怎么样？' }); const yes = await buildContext(c); await db.messages.update('life-a7', { content: '一加一等于几？' }); const no = await buildContext(c); return { yes: yes[0].content, no: no[0].content, messages: await db.messages.count() }; }); expect(r.yes).toContain('角色自主生活资料'); expect(r.yes).toContain('编辑工作'); expect(r.yes).not.toContain('辞职'); expect(r.no).not.toContain('角色自主生活资料'); expect(r.messages).toBe(16); });
for (const encrypted of [false, true])
    test('actual ZIP restore preserves life and remaps copied owner, encrypted=' + encrypted, async ({ page }) => {
        await seed(page);
        const r = await page.evaluate(async (encrypted) => {
            const { db } = await import('/src/store.ts'), m = await import('/src/characterLife.ts');
            await m.saveCharacterLife('life-a', { focus: '源角色生活', mood: '平静', events: [{ id: 'stable-event', title: '读书', detail: '进行中', status: 'ongoing', createdAt: 1, updatedAt: 2, source: 'simulation', confidence: 'simulated', progress: [{ at: 2, text: '读到第二章' }] }] });
            const { createZipBackup, readBackupZip } = await import('/src/backupZip.ts'), password = encrypted ? 'synthetic life password' : undefined;
            const before = JSON.stringify(await db.messages.toArray());
            const files = await readBackupZip(await createZipBackup({ closedOtherClients: true, password }), password);
            const { openRestoreDatabase } = await import('/src/restoreData.ts'), target = await openRestoreDatabase('life-restore-' + crypto.randomUUID());
            await target.table('characters').put({ id: 'life-a', name: '本地不同角色', persona: '别的设定' });
            const { prepareImport, defaultImportOptions, getImportPlan } = await import('/src/importPlan.ts');
            const plan = await prepareImport(files, { ...defaultImportOptions, mode: 'merge' }, { database: target, password });
            try {
                const restored = getImportPlan(plan, target).database, rows = await restored.table('themes').toArray(), life = rows.filter((r: any) => r.characterLife).map((r: any) => r.characterLife);
                return { life, owner: await restored.table('characters').get(life[0].characterId), source: before === JSON.stringify(await db.messages.toArray()) };
            }
            finally {
                await plan.dispose();
                await target.delete();
            }
        }, encrypted);
        expect(r.life).toHaveLength(1);
        expect(r.life[0].characterId).not.toBe('life-a');
        expect(r.owner.name).toBe('life-a');
        expect(r.life[0].events[0].progress).toEqual([{ at: 2, text: '读到第二章' }]);
        expect(r.source).toBe(true);
    });
test('expired or interrupted life claim never auto-replays; manual recovery works', async ({ page }) => { await seed(page); const calls = await mock(page); const r = await page.evaluate(async () => { const m = await import('/src/characterLife.ts'), g = await import('/src/characterLifeGeneration.ts'); await m.changeCharacterLife('life-a', s => { s.enabled = true; s.attempt = { token: 'expired', status: 'running', at: Date.now() - 86400000 }; }); await g.runCharacterLife('life-a'); const before = await m.readCharacterLife('life-a'); await g.runCharacterLife('life-a', true); return { before, after: await m.readCharacterLife('life-a') }; }); expect(r.before.events).toHaveLength(0); expect(calls()).toBe(1); expect(r.after.attempt?.status).toBe('succeeded'); });
test('Gemini uses configured protocol/model and accepts one complete response', async ({ page }) => { await seed(page); let request: any; await page.evaluate(async () => { await (await import('/src/store.ts')).db.apiConfigs.update('life-api', { provider: 'gemini', model: 'gemini-mock' }); }); await page.route('https://life.test/**', r => { request = r.request().postDataJSON(); return r.fulfill({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result()) }] } }] } }); }); await page.evaluate(async () => await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true)); expect(request.contents).toBeTruthy(); expect(request.generationConfig.maxOutputTokens).toBe(3000); });
test('two browser tabs share one IndexedDB claim', async ({ page, context }) => { await seed(page); let entered!: () => void, release!: () => void, calls = 0; const started = new Promise<void>(r => entered = r), gate = new Promise<void>(r => release = r); await context.route('https://life.test/**', async (r) => { calls++; entered(); await gate; return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result()) }, finish_reason: 'stop' }] } }); }); const name = await page.evaluate(async () => (await import('/src/store.ts')).db.backendDB().name); const other = await context.newPage(); await isolatedApp(other, name); const first = page.evaluate(async () => await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true)); await started; const second = await other.evaluate(async () => await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true)); expect(second).toBeNull(); expect(calls).toBe(1); release(); await first; await other.close(); });
test('life read is bounded with 10000 unrelated messages and does not scan messages', async ({ page }) => {
    await seed(page, true);
    const r = await page.evaluate(async () => {
        const { db } = await import('/src/store.ts'), m = await import('/src/characterLife.ts');
        await db.messages.bulkPut(Array.from({ length: 10000 }, (_, i) => ({ id: 'bulk' + i, conversationId: 'unrelated', role: 'user' as const, content: '长历史'.repeat(20), createdAt: i })));
        await m.changeCharacterLife('life-a', s => { s.enabled = true; s.focus = '编辑工作'; });
        const c = (await db.conversations.where('characterId').equals('life-a').first())!, { characterLifeContext } = await import('/src/characterLifeChat.ts');
        let reads = 0;
        const hook = () => { reads++; };
        db.messages.hook('reading', hook);
        try {
            const t = performance.now();
            const block = await characterLifeContext(c, [{ id: 'current', conversationId: c.id, role: 'user', content: '工作怎么样？', createdAt: Date.now() }], 1800);
            return { ms: performance.now() - t, reads, block };
        }
        finally {
            db.messages.hook('reading').unsubscribe(hook);
        }
    });
    console.log('LIFE_CONTEXT_PERF', JSON.stringify({ messages: 10000, ms: r.ms, reads: r.reads }));
    expect(r.reads).toBe(0);
    expect(r.block).toContain('编辑工作');
    expect(r.block.length).toBeLessThanOrEqual(1800);
});
test('hourly independent diary can write a later interval without new chat/life revision', async ({ page }) => { await seed(page); await page.clock.install(); let calls = 0; await page.route('https://life.test/**', r => { calls++; return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ title: '独处想法', body: '只记录角色自己的主观想法，不虚构玩家互动。'.repeat(15) }) }, finish_reason: 'stop' }] } }); }); await page.evaluate(async () => { await (await import('/src/characterLife.ts')).changeCharacterLife('life-a', s => { s.enabled = true; s.lastAdvancedAt = Date.now(); }); await (await import('/src/privateNotesArchive.ts')).saveNoteSchedule({ mode: 'interval', intervalMinutes: 60 }); await (await import('/src/privateNotesGeneration.ts')).generatePrivateNote('life-a'); }); await page.clock.setFixedTime(new Date(Date.now() + 2 * 3600000)); const count = await page.evaluate(async () => { const g = await import('/src/privateNotesGeneration.ts'); await g.generatePrivateNote('life-a'); return (await g.loadNotes('life-a')).length; }); expect(calls).toBe(2); expect(count).toBe(2); });
test('failed manual dream does not block automatic diary lane', async ({ page }) => {
    await seed(page);
    await page.route('https://life.test/**', r => r.abort('failed'));
    await page.evaluate(async () => {
        await (await import('/src/characterLife.ts')).changeCharacterLife('life-a', s => { s.enabled = true; });
        try {
            await (await import('/src/privateNotesGeneration.ts')).generatePrivateNote('life-a', true, '梦境');
        }
        catch { }
    });
    await page.unroute('https://life.test/**');
    await page.route('https://life.test/**', r => r.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ title: '生活', body: '阅读时的个人想法。'.repeat(30) }) }, finish_reason: 'stop' }] } }));
    expect(await page.evaluate(async () => !!await (await import('/src/privateNotesGeneration.ts')).generatePrivateNote('life-a'))).toBe(true);
});
test('life timeout releases claim and remains manual-only', async ({ page }) => { await seed(page); await page.clock.install(); let entered!: () => void; const started = new Promise<void>(r => entered = r); await page.route('https://life.test/**', () => { entered(); }); await page.evaluate(async () => { (window as any).__lifePending = (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true).catch(() => null); }); await started; await page.clock.fastForward(150001); const r = await page.evaluate(async () => { await (window as any).__lifePending; return (await import('/src/characterLife.ts')).readCharacterLife('life-a'); }); expect(r.attempt?.status).toBe('failed'); expect(r.events).toHaveLength(0); });
test('World and another character never receive Daily life state', async ({ page }) => { await seed(page, true); const r = await page.evaluate(async () => { const { db } = await import('/src/store.ts'), { getConversation } = await import('/src/chatService.ts'), { buildContext } = await import('/src/chatContext.ts'); await (await import('/src/characterLife.ts')).changeCharacterLife('life-a', s => { s.enabled = true; s.focus = '只能属于A的自主生活'; }); await db.worlds.put({ id: 'life-world', name: '隔离世界', description: '世界背景', rules: '' }); await db.worldProfiles.put({ id: 'life-profile', worldId: 'life-world', characterId: 'life-a', setting: '世界角色' }); const w = await getConversation('life-a', 'life-world'); await db.messages.put({ id: 'world-query', conversationId: w.id, role: 'user', content: '工作怎么样？', createdAt: Date.now() }); const b = (await db.conversations.where('characterId').equals('life-b').first())!; await db.messages.update('life-b7', { role: 'user', content: '工作怎么样？' }); return { w: (await buildContext(w))[0].content, b: (await buildContext(b))[0].content }; }); expect(r.w).not.toContain('只能属于A'); expect(r.w).not.toContain('角色自主生活资料'); expect(r.b).not.toContain('只能属于A'); });
for (const kind of ['diary', 'reply'])
    test('affection guard also applies to ' + kind, async ({ page }) => {
        await seed(page);
        await page.route('https://life.test/**', r => r.fulfill({ json: { choices: [{ message: { content: kind === 'reply' ? '我讨厌玩家，后悔认识玩家。' : JSON.stringify({ title: '日记', body: ('我讨厌玩家，后悔认识玩家。').repeat(30) }) }, finish_reason: 'stop' }] } }));
        const r = await page.evaluate(async (kind) => {
            const a = await import('/src/privateNotesArchive.ts'), g = await import('/src/privateNotesGeneration.ts');
            if (kind === 'reply') {
                await a.appendPrivateNote('life-a', { id: 'note', characterId: 'life-a', kind: '日记', createdAt: 1, title: '已有', body: '原文保留', comments: ['玩家评论'], sourceLastMessageAt: 0 });
                try {
                    await g.replyToPrivateNoteComment('life-a', 'note', '玩家评论');
                }
                catch { }
            }
            else {
                try {
                    await g.generatePrivateNote('life-a', true, '日记');
                }
                catch { }
            }
            return g.loadNotes('life-a');
        }, kind);
        if (kind === 'reply')
            expect(r[0].comments).toEqual(['玩家评论']);
        else
            expect(r).toHaveLength(0);
    });
test('late response from superseded lease cannot invalidate the replacement task', async ({ page }) => {
    await seed(page);
    const entered: Array<() => void> = [], release: Array<() => void> = [];
    const started = [0, 1].map(i => new Promise<void>(r => entered[i] = r)), gates = [0, 1].map(i => new Promise<void>(r => release[i] = r));
    let calls = 0;
    await page.route('https://life.test/**', async (r) => { const i = calls++; entered[i](); await gates[i]; return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result()) }, finish_reason: 'stop' }] } }); });
    const first = page.evaluate(async () => {
        try {
            return await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true);
        }
        catch {
            return null;
        }
    });
    await started[0];
    const second = page.evaluate(async () => {
        try {
            return await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true, Date.now() + 181000);
        }
        catch {
            return null;
        }
    });
    await page.waitForTimeout(100);expect(calls).toBe(1);
    release[0]();
    expect(await first).toBeNull();
    await started[1];
    release[1]();
    const saved = await second;
    expect(saved?.attempt?.status).toBe('succeeded');
    expect(saved?.events).toHaveLength(1);
    expect(calls).toBe(2);
});
test('malformed legacy life data is reported without overwriting original row', async ({ page }) => {
    await seed(page);
    const r = await page.evaluate(async () => {
        const { db } = await import('/src/store.ts'), m = await import('/src/characterLife.ts');
        const row = { ...m.lifeRow({ version: 1, characterId: 'life-a', lastAdvancedAt: 0, focus: '', mood: '', events: [] }), characterLife: { version: 1, characterId: 'life-a', lastAdvancedAt: 0, focus: '', mood: '', events: [], enabled: 'false' } };
        await db.themes.put(row as any);
        let failed = false;
        try {
            await m.readCharacterLife('life-a');
        }
        catch {
            failed = true;
        }
        return { failed, intact: JSON.stringify(row) === JSON.stringify(await db.themes.get(m.lifeKey('life-a'))) };
    });
    expect(r).toEqual({ failed: true, intact: true });
});
test('expired diary request cannot silently replay after interval changes', async ({ page }) => { await seed(page); let calls = 0; await page.route('https://life.test/**', r => { calls++; return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ title: '不该自动请求', body: '旧任务结果尚未确认。'.repeat(30) }) }, finish_reason: 'stop' }] } }); }); const r = await page.evaluate(async () => { const { db } = await import('/src/store.ts'), m = await import('/src/characterLife.ts'); await m.changeCharacterLife('life-a', s => { s.enabled = true; }); await (await import('/src/privateNotesArchive.ts')).saveNoteSchedule({ mode: 'interval', intervalMinutes: 60 }); await db.themes.put({ id: 'private-notes-task:life-a:automatic', color: '#fff', font: 'sans', iconStyle: 'rounded', opacity: 1, blur: 0, privateNotesTask: { token: 'old', until: Date.now() - 86400000, source: 'old-interval' } } as any); const note = await (await import('/src/privateNotesGeneration.ts')).generatePrivateNote('life-a'); return { note }; }); expect(calls).toBe(0); expect(r.note).toBeNull(); });
test('first progression has zero invented offline duration; Daily lore is used without World lore', async ({ page }) => { await seed(page); await page.evaluate(async () => { const { db } = await import('/src/store.ts'), { newBook, newEntry } = await import('/src/loreTypes.ts'); const g = { ...newBook(), global: true, name: '日常资料' }, w = { ...newBook(), global: false, worldIds: ['other'], name: '私有世界' }; await db.lorebooks.bulkPut([g, w]); await db.loreEntries.bulkPut([{ ...newEntry(g.id), constant: true, content: 'DAY_ONLY_RULE' }, { ...newEntry(w.id), constant: true, content: 'WORLD_PRIVATE_RULE' }]); }); let input: any; await page.route('https://life.test/**', r => { input = JSON.parse(r.request().postDataJSON().messages[1].content); return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result()) }, finish_reason: 'stop' }] } }); }); await page.evaluate(async () => await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true)); expect(input.firstAdvance).toBe(true); expect(input.elapsedMs).toBe(0); expect(JSON.stringify(input)).toContain('DAY_ONLY_RULE'); expect(JSON.stringify(input)).not.toContain('WORLD_PRIVATE_RULE'); });
test('large bounded life context still recalls newest personal event without full state overflow', async ({ page }) => { await seed(page, true); const r = await page.evaluate(async () => { const { db } = await import('/src/store.ts'), m = await import('/src/characterLife.ts'); await m.changeCharacterLife('life-a', s => { s.enabled = true; s.events = Array.from({ length: 40 }, (_, i) => ({ id: 'e' + i, title: '工作任务' + i, detail: '记录个人工作中的普通问题。'.repeat(25), status: 'ongoing' as const, createdAt: 1, updatedAt: i, source: 'simulation' as const, confidence: 'simulated' as const })); }); const c = (await db.conversations.where('characterId').equals('life-a').first())!; return (await import('/src/characterLifeChat.ts')).characterLifeContext(c, [{ id: 'now', conversationId: c.id, role: 'user', content: '最近工作怎么样？', createdAt: Date.now() }], 1800); }); expect(r).toContain('工作任务39'); expect(r.length).toBeLessThanOrEqual(1800); });
test('authorized major proposal requires explicit UI confirmation', async ({ page }) => { await seed(page); await mock(page, result({ events: [{ title: '职业变化提案', detail: '辞职，尚未确认', level: 'major', actor: 'self' }] })); await page.evaluate(async () => { await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true); (await import('/src/store.ts')).usePhone.getState().set({ activeApp: '手记' }); }); await page.getByLabel('当前角色', { exact: true }).selectOption('life-a'); await page.getByRole('button', { name: '生活', exact: true }).click(); page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: '确认授权事件', exact: true }).click(); expect(await page.evaluate(async () => (await (await import('/src/characterLife.ts')).readCharacterLife('life-a')).events.length)).toBe(0); page.once('dialog', d => d.accept()); await page.getByRole('button', { name: '确认授权事件', exact: true }).click(); await expect.poll(() => page.evaluate(async () => (await (await import('/src/characterLife.ts')).readCharacterLife('life-a')).events.length)).toBe(1); const r = await page.evaluate(async () => (await import('/src/characterLife.ts')).readCharacterLife('life-a')); expect(r.proposals).toHaveLength(0); expect(r.events[0].source).toBe('manual'); expect(r.events[0].confidence).toBe('confirmed'); });
test('stopped foreground scheduler cannot start a delayed paid task', async ({ page }) => { await seed(page); let calls = 0; await page.route('https://life.test/**', r => { calls++; return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result()) }, finish_reason: 'stop' }] } }); }); const r = await page.evaluate(async () => { await (await import('/src/characterLife.ts')).changeCharacterLife('life-a', s => { s.enabled = true; }); const stop = (await import('/src/characterLifeScheduler.ts')).installCharacterLifeScheduler(); stop(); await new Promise(r => setTimeout(r, 100)); return (await import('/src/characterLife.ts')).readCharacterLife('life-a'); }); expect(calls).toBe(0); expect(r.attempt).toBeUndefined(); });
test('explicit topic recalls an older matching life event before unrelated recent ones', async ({ page }) => { await seed(page, true); const r = await page.evaluate(async () => { const { db } = await import('/src/store.ts'); await (await import('/src/characterLife.ts')).changeCharacterLife('life-a', s => { s.enabled = true; s.events = Array.from({ length: 12 }, (_, i) => ({ id: 'topic' + i, title: i === 0 ? '整理旧书' : '其他任务' + i, detail: '普通个人活动'.repeat(30), status: 'ongoing' as const, createdAt: 1, updatedAt: i })); }); const c = (await db.conversations.where('characterId').equals('life-a').first())!; return (await import('/src/characterLifeChat.ts')).characterLifeContext(c, [{ id: 'query', conversationId: c.id, role: 'user', content: '整理旧书怎么样了？', createdAt: Date.now() }], 1800); }); expect(r).toContain('整理旧书'); expect(r.length).toBeLessThanOrEqual(1800); });
test('life recovery button becomes available when lease expires without a database update', async ({ page }) => { await seed(page); await page.clock.install(); await page.evaluate(async () => { await (await import('/src/characterLife.ts')).changeCharacterLife('life-a', s => { s.attempt = { token: 'pending', status: 'running', at: Date.now() }; }); (await import('/src/store.ts')).usePhone.getState().set({ activeApp: '手记' }); }); await page.getByLabel('当前角色', { exact: true }).selectOption('life-a'); await page.getByRole('button', { name: '生活', exact: true }).click(); await page.getByText('生活引擎设置与手动推进',{exact:true}).click(); const button = page.getByRole('button', { name: '推进一次 / 手动恢复', exact: true }); await expect(button).toBeDisabled(); await page.clock.fastForward(180010); await expect(button).toBeEnabled(); });
test('actual application reopen performs one eligible advance without manual life API invocation', async ({ page }) => { await seed(page); await page.evaluate(async () => { await (await import('/src/characterLife.ts')).changeCharacterLife('life-a', s => { s.enabled = true; s.lastAdvancedAt = Date.now() - 2 * 86400000; }); await (await import('/src/privateNotesArchive.ts')).saveNoteSchedule({ mode: 'important', intervalMinutes: 60 }); }); const calls = await mock(page); await page.reload(); await expect.poll(() => page.evaluate(async () => (await (await import('/src/characterLife.ts')).readCharacterLife('life-a')).attempt?.status)).toBe('succeeded'); expect(calls()).toBe(1); expect(await page.evaluate(async () => (await (await import('/src/characterLife.ts')).readCharacterLife('life-a')).events.length)).toBe(1); });
test('diary and life progression serialize paid work for the same owner', async ({ page }) => { await seed(page); let calls = 0, entered!: () => void, release!: () => void; const started = new Promise<void>(r => entered = r), gate = new Promise<void>(r => release = r); await page.route('https://life.test/**', async (r) => { calls++; const life = r.request().postDataJSON().messages[0].content.includes('只推进角色自己的普通生活'); if (!life) {
    entered();
    await gate;
} return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify(life ? result() : { title: '独处日记', body: '角色自己的想法，不改变玩家经历。'.repeat(20) }) }, finish_reason: 'stop' }] } }); }); const diary = page.evaluate(async () => { try {
    return await (await import('/src/privateNotesGeneration.ts')).generatePrivateNote('life-a', true, '日记');
}
catch {
    return null;
} }); await started; const life = await page.evaluate(async () => await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true)); release(); const saved = await diary; expect(life).toBeNull(); expect(calls).toBe(1); expect(saved?.kind).toBe('日记'); });
test('manual diary waits for an existing life task without another paid request', async ({ page }) => { await seed(page); let calls = 0, entered!: () => void, release!: () => void; const started = new Promise<void>(r => entered = r), gate = new Promise<void>(r => release = r); await page.route('https://life.test/**', async (r) => { calls++; entered(); await gate; return r.fulfill({ json: { choices: [{ message: { content: JSON.stringify(result()) }, finish_reason: 'stop' }] } }); }); const life = page.evaluate(async () => await (await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a', true)); await started; const note = await page.evaluate(async () => await (await import('/src/privateNotesGeneration.ts')).generatePrivateNote('life-a', true, '日记')); expect(note).toBeNull(); expect(calls).toBe(1); release(); await life; });
test('AI progress remains simulated and preserves original manually recorded detail',async({page})=>{await seed(page);await page.evaluate(async()=>{await(await import('/src/characterLife.ts')).saveCharacterLife('life-a',{focus:'阅读',mood:'平静',events:[{id:'manual-event',title:'整理旧书',detail:'手动确认的起点',status:'ongoing',createdAt:1,updatedAt:2,source:'manual',confidence:'confirmed'}]})});await mock(page,result({events:[],updates:[{id:'manual-event',status:'ongoing',detail:'模拟：整理了书架的一部分，尚未结束'}]}));const e=await page.evaluate(async()=>{await(await import('/src/characterLifeGeneration.ts')).runCharacterLife('life-a',true);return(await(await import('/src/characterLife.ts')).readCharacterLife('life-a')).events[0]});expect(e.source).toBe('simulation');expect(e.confidence).toBe('simulated');expect(e.progress?.map(p=>p.text)).toContain('手动确认的起点');});

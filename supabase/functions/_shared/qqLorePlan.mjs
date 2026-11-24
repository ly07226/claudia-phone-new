// Generated from existing loreEngine.ts / loreTypes.ts by scripts/build-qq-lore.mjs. Do not hand edit.
export const loreLimits = {
    fileBytes: 5 * 1024 * 1024,
    entries: 3000,
    contentChars: 20000,
    totalChars: 2000000,
    promptChars: 8000,
    scanMessages: 30,
};
export function normalizeEntry(e) {
    return {
        ...e,
        triggerMode: e.triggerMode ?? "history",
        scanAssistant: e.scanAssistant ?? true,
        insertionDepth: e.insertionDepth ?? 0,
        role: e.role ?? "system",
        regex: e.regex ?? false,
        useProbability: e.useProbability ?? false,
        probability: e.probability ?? 100,
        compatibilityIssues: e.compatibilityIssues ?? [],
    };
}
const ref = (m) => ({ id: m.id, role: m.role });
export function loreScanMessages(raw, book, history) {
    const e = normalizeEntry(raw);
    if (e.constant)
        return [];
    if (e.triggerMode === "instant") {
        const latest = [...history].reverse().find(m => m.role === "user");
        return latest ? [latest] : [];
    }
    // Window first, then role filtering: scanDepth remains a message count, not user-turn count.
    return history.slice(-(e.scanDepth ?? book.scanDepth)).filter(m => m.role === "user" || (e.scanAssistant && m.role === "assistant"));
}
function scanBuffer(messages, foldCase = false) {
    let text = "";
    const spans = messages.map((m, index) => {
        if (index)
            text += "\n";
        const start = text.length;
        text += foldCase ? m.content.toLowerCase() : m.content;
        return { ...ref(m), start, end: text.length };
    });
    return { text, spans };
}
function assess(raw, b, h, random, regex) {
    const e = normalizeEntry(raw);
    const d = { entryId: e.id, lorebookId: b.id, triggerMode: e.constant ? "constant" : e.triggerMode, scanAssistant: e.constant || e.triggerMode === "instant" ? null : e.scanAssistant, scannedMessageCount: 0, matchedMessages: [], crossMessageMatch: false, attribution: "first-match-per-key", outcome: "skipped", completeness: "omitted", reason: "primary-miss" };
    const fail = (reason) => ({ eligible: false, diagnostic: { ...d, reason } });
    if (!b.enabled)
        return fail("book-disabled");
    if (!e.enabled)
        return fail("entry-disabled");
    if (e.compatibilityIssues.length)
        return fail("compatibility-paused");
    if (!e.constant) {
        const messages = loreScanMessages(e, b, h);
        d.scannedMessageCount = messages.length;
        if (e.triggerMode === "instant" && !messages.length)
            return fail("no-user-message");
        let primary, secondary;
        if (e.regex) {
            if (!regex || regex.error)
                return fail("regex-error");
            primary = regex.primary;
            secondary = regex.secondary;
            d.matchedMessages = (regex.matches || []).map(({ id, role }) => ({ id, role }));
            d.crossMessageMatch = regex.crossMessageMatch || false;
            if (!regex.matches)
                d.attribution = "unavailable";
        }
        else {
            const buffer = scanBuffer(messages, !e.caseSensitive);
            const matches = new Map();
            const hit = (key) => {
                if (!key)
                    return false;
                const needle = e.caseSensitive ? key : key.toLowerCase();
                // Match within a single message only. Joining messages with newlines
                // could fabricate a trigger across two unrelated turns.
                let found = false;
                for (const span of buffer.spans) {
                    if (buffer.text.slice(span.start, span.end).includes(needle)) {
                        matches.set(span.id, { id: span.id, role: span.role });
                        found = true;
                    }
                }
                return found;
            };
            primary = e.primaryKeys.map(hit);
            secondary = e.secondaryKeys.map(hit);
            d.matchedMessages = [...matches.values()];
        }
        if (!primary.some(Boolean))
            return fail("primary-miss");
        if (e.selective && e.secondaryKeys.length) {
            const passes = [() => secondary.some(Boolean), () => !secondary.every(Boolean), () => !secondary.some(Boolean), () => secondary.every(Boolean)][e.selectiveLogic]?.() || false;
            if (!passes)
                return fail("secondary-miss");
        }
    }
    if (!e.constant && e.useProbability && !(e.probability >= 100 || (e.probability > 0 && random() < e.probability / 100)))
        return fail("probability");
    return { eligible: true, diagnostic: d };
}
export function entryActive(raw, b, h, random = Math.random, regex) {
    return assess(raw, b, h, random, regex).eligible;
}
/** Local, deterministic passage retrieval. No API calls or additional credentials. */
export function retrieveLorePassages(content, history, budget) {
    if (content.length <= budget)
        return content;
    if (budget <= 0)
        return "";
    const query = history.filter(m => m.role === "user").slice(-3).map(m => m.content).join(" ").toLowerCase();
    const terms = [...new Set((query.match(/[\p{Script=Han}]{2,4}|[a-z0-9]{3,}/gu) || []))].slice(0, 80);
    // Preserve explicit qualifications with the preceding rule. A sentence like
    // "但是不能替用户决定" must never be selected without its governing rule.
    const chunks = [];
    for (const paragraph of content.split(/\n{2,}/)) {
        // A fitting paragraph is an atomic unit: preserve implicit qualifications,
        // negations and character voice that keyword heuristics cannot recognize.
        if (paragraph.trim().length <= budget) {
            chunks.push(paragraph.trim());
            continue;
        }
        const sentences = (paragraph.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [paragraph]).map(x => x.trim()).filter(Boolean);
        const paragraphStart = chunks.length;
        for (const sentence of sentences) {
            const dependent = /^(?:但(?:是)?|不过|然而|否则|除非|只有|仅当|前提是|与此同时|同时|另外|并且|而且|因此|所以|即使|哪怕|不得|不能|禁止|切勿|例外|注意[：:]?)/u.test(sentence);
            if (dependent && chunks.length > paragraphStart) {
                chunks[chunks.length - 1] += sentence;
            }
            else
                chunks.push(sentence);
        }
    }
    const ranked = chunks.map((text, index) => ({ text, index, score: terms.reduce((n, t) => n + (text.toLowerCase().includes(t) ? 1 : 0), 0) }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
    const chosen = [];
    let used = 0;
    for (const item of ranked) {
        const separator = chosen.length ? 2 : 0;
        const room = budget - used - separator;
        if (room <= 0)
            break;
        if (item.text.length > room)
            continue;
        chosen.push(item);
        used += item.text.length + separator;
    }
    // A single long unsplittable sentence should not prevent every other entry
    // from being considered. Skip this entry if no complete passage fits.
    return chosen.sort((a, b) => a.index - b.index).map(x => x.text).join("\n\n");
}
/** Metadata only. Entry content, keys and chat text are never part of diagnostics. */
export function planLore(candidates, history, remainingBudget = loreLimits.promptChars, random = Math.random, regex = {}) {
    // Always-on instructions must be considered before optional keyword lore.
    // They are not constrained by the ordinary 4k-per-book / 8k-total lore budgets.
    const sorted = candidates.map(c => ({ ...c, entry: normalizeEntry(c.entry) })).sort((a, b) => Number(b.entry.constant) - Number(a.entry.constant) || b.entry.priority - a.entry.priority || a.entry.createdAt - b.entry.createdAt || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
    const selected = [], diagnostics = [];
    const used = new Map();
    let total = 0, optionalTotal = 0;
    for (const { entry, book } of sorted) {
        const result = assess(entry, book, history, random, regex[entry.id]);
        const d = result.diagnostic;
        diagnostics.push(d);
        if (!result.eligible)
            continue;
        // Keep chat responsive: never fail a request solely because optional lore
        // exceeds its configured budget. Preserve whole entries when possible.
        const available = Math.min(remainingBudget - total, entry.constant ? remainingBudget - total : Math.min(loreLimits.promptChars - optionalTotal, book.charBudget - (used.get(book.id) || 0)));
        const effective = { ...entry, content: retrieveLorePassages(entry.content, history, Math.max(0, available - 2)) };
        const cost = effective.content.length + 2, bookUsed = used.get(book.id) || 0;
        if (!effective.content.trim()) {
            d.reason = "context-budget";
            continue;
        }
        if (entry.constant && total + cost > remainingBudget) {
            // A constant entry receives first claim on the shared context budget.
            // If no complete passage fits, keep the request responsive and record
            // the omission instead of silently pretending it was injected.
            d.reason = "context-budget";
            continue;
        }
        if (!entry.constant && (total + cost > remainingBudget || optionalTotal + cost > loreLimits.promptChars)) {
            d.reason = "context-budget";
            continue;
        }
        if (!entry.constant && bookUsed + cost > book.charBudget) {
            d.reason = "book-budget";
            continue;
        }
        if (!entry.constant) {
            used.set(book.id, bookUsed + cost);
            optionalTotal += cost;
        }
        total += cost;
        selected.push(effective);
        d.outcome = "injected";
        d.completeness = effective.content === entry.content ? "full" : "partial";
        d.reason = "injected";
    }
    return { entries: selected, activated: selected.map(e => e.id), diagnostics, regexErrors: Object.fromEntries(Object.entries(regex).filter(([, r]) => r.error).map(([id, r]) => [id, r.error])) };
}
export function injectLore(system, history, entries) {
    const sorted = entries.map(normalizeEntry);
    const own = (e) => ({
        role: e.role,
        content: e.content,
    });
    // Preserve legacy default System profile placement inside the first system message.
    const profileEntries = sorted.filter((e) => e.insertionPosition === "before-profile" ||
        e.insertionPosition === "after-profile");
    const splitProfile = profileEntries.some((e) => e.role !== "system");
    const before = profileEntries.filter((e) => e.insertionPosition === "before-profile");
    const after = profileEntries.filter((e) => e.insertionPosition === "after-profile");
    const prefix = splitProfile
        ? [
            { role: "system", content: "以下是当前会话的角色与设定资料。" },
            ...before.map(own),
            { role: "system", content: system },
            ...after.map(own),
        ]
        : [
            {
                role: "system",
                content: [
                    ...before.map((e) => e.content),
                    system,
                    ...after.map((e) => e.content),
                ].join("\n\n"),
            },
        ];
    const slots = Array.from({ length: history.length + 1 }, () => []);
    for (const e of sorted) {
        if (e.insertionPosition === "before-profile" ||
            e.insertionPosition === "after-profile") {
            continue;
        }
        const index = e.insertionPosition === "after-conversation"
            ? history.length
            : e.insertionPosition === "at-depth"
                ? Math.max(0, history.length - e.insertionDepth)
                : 0;
        slots[index].push(own(e));
    }
    return [
        ...prefix,
        ...slots.flatMap((slot, i) => i < history.length ? [...slot, history[i]] : slot),
    ];
}

export const regexWorkerSource="function compileLoreRegex(value, caseSensitive = false) {\n    let source = value;\n    let flags = caseSensitive ? \"\" : \"i\";\n    if (value.startsWith(\"/\")) {\n        const end = value.lastIndexOf(\"/\");\n        if (end <= 0)\n            throw Error(\"正则缺少结束斜线。\");\n        source = value.slice(1, end);\n        flags = value.slice(end + 1);\n    }\n    if (!source || source.length > 200)\n        throw Error(\"正则长度需为 1–200 字符。\");\n    return new RegExp(source, flags);\n}\nself.onmessage = (event) => {\n    const result = {};\n    for (const job of event.data) {\n        try {\n            const matches = new Map();\n            let crossMessageMatch = false;\n            const hit = (s) => {\n                const match = compileLoreRegex(s, job.caseSensitive).exec(job.text);\n                if (!match)\n                    return false;\n                const start = match.index, end = start + match[0].length;\n                const origins = (job.spans || []).filter(span => end > start ? span.start < end && span.end > start : span.start <= start && span.end >= start);\n                crossMessageMatch ||= origins.length > 1;\n                for (const origin of origins)\n                    matches.set(origin.id, { id: origin.id, role: origin.role });\n                return true;\n            };\n            result[job.id] = {\n                primary: job.primary.map(hit),\n                secondary: job.secondary.map(hit),\n                matches: [...matches.values()],\n                crossMessageMatch,\n            };\n        }\n        catch {\n            result[job.id] = {\n                primary: [],\n                secondary: [],\n                error: \"正则无效，该条目未激活。\",\n            };\n        }\n    }\n    self.postMessage(result);\n};\n";
/** Local topic expansion only. It never converts a speaker's words into a fact. */
const concepts = [
    ['menstrual', ['来月经', '月经', '生理期', '例假', '大姨妈', '经期']],
    ['health', ['月经', '生理期', '例假', '大姨妈', '经期', '肚子', '腹痛', '难受', '不舒服', '身体']],
    ['marriage', ['结婚', '婚姻', '婚礼', '领证', '成家', '不婚']],
    ['promise', ['答应', '承诺', '约定', '说好', '保证', '失约']],
    ['travel', ['旅行', '旅游', '出游', '旅途']],
    ['food', ['吃饭', '晚饭', '午饭', '早餐', '饮食', '餐厅']],
    ['work', ['工作', '上班', '加班', '公司', '同事']],
    ['study', ['学习', '考试', '上课', '学校']],
    ['relationship', ['恋爱', '恋人', '伴侣', '分手', '关系', '和好', '和解']],
    ['exhibition', ['画展', '展览', '美术馆']],
];
const stop = new Set(['今天', '明天', '昨天', '现在', '晚上', '下午', '上午', '我们', '你们', '自己', '这个', '那个', '一下', '还是', '已经', '什么', '怎么', '觉得', '可以', '因为', '所以', '时候', '一个', '不是', '不想', '喜欢', '讨厌', 'really', 'about', 'with', 'that', 'this', 'have']);
export function historyTerms(text) {
    const normalized = text.normalize('NFKC').toLowerCase(), topics = [];
    for (const [name, aliases] of concepts)
        if (aliases.some(a => normalized.includes(a)))
            topics.push('@' + name);
    const lexical = new Set();
    for (const word of normalized.match(/[\p{Script=Han}]+|[a-z0-9_]{3,}/gu) ?? []) {
        if (/^[\p{Script=Han}]+$/u.test(word)) {
            for (let i = 0; i < word.length - 1; i++) {
                const part = word.slice(i, i + 2);
                if (!stop.has(part))
                    lexical.add(part);
                if (lexical.size >= 256)
                    break;
            }
        }
        else if (!stop.has(word))
            lexical.add(word);
        if (lexical.size >= 256)
            break;
    }
    return [...topics, ...lexical];
}
export const uncertainHistory = (text) => /假如|假设|如果|要是|也许|可能|猜测|开玩笑|逗你|玩笑|并非真的|并不是真的|举个例子|比如说/u.test(text.replace(/(?:不是|并非|没有|没在)(?:开)?玩笑|不可能/gu, ''));
export const importantHistory = (text) => /月经|生理期|例假|大姨妈|经期|不喜欢|讨厌|不想|不愿|不要|拒绝|不婚|过敏|承诺|答应|约定|说好|保证|我们.{0,20}(?:去过|一起|第一次|上次)|生病|发烧|受伤|分手|伴侣|结婚|婚姻|离婚|家人|失业|入职|离职/u.test(text);
export const greetingQuery = (text) => /^(?:早上好|早安|晚上好|晚安|你好|我回来了|在吗|今天怎么样|好累|有点累)[。！!？?，,\s]*$/u.test(text.trim());
export const durableHistory = (text) => /不喜欢|讨厌|不想|不愿|不要|拒绝|不婚|不接受|不可能接受|偏好|喜欢|愿意|希望|宁愿|改变想法|改变主意|过敏|承诺|答应|约定|说好|保证|我们.{0,20}(?:去过|一起|第一次|上次)/u.test(text);
/** Only explicit first-person marriage attitudes. Unknown wording is never
 * coerced into a stance; facts are still quoted, not rewritten. */
export function marriagePosition(text) {
    if (uncertainHistory(text) || !historyTerms(text).includes('@marriage'))
        return;
    text = text.trim();
    // Deliberately narrow: a question, attribution or "want to understand" is
    // not an attitude. Do not infer consent or a plan from a topic mention.
    const stance = text.match(/^我(?:(?:已经改变想法|改变想法|改主意|现在|已经|真的|明确|一直|仍然|其实|绝对|从来|完全|确实|就是|开始)[，, ]?){0,4}(.+)/u)?.[1];
    if (!stance || /(?:结婚|婚姻)(?:了)?[吗么?？]/u.test(stance))
        return;
    const target = '(?:(?:再|去|和你|与你|跟你|任何形式的|所谓的|这种|一段稳定的|一段|这段) *){0,2}(?:结婚|婚姻)';
    if (new RegExp('^(?:不想|不愿意?|不喜欢|讨厌|拒绝|不接受|不可能接受)' + target, 'u').test(stance) || /^不婚/u.test(stance))
        return 'oppose';
    if (new RegExp('^(?:愿意|想要?|接受)' + target, 'u').test(stance))
        return 'support';
}
export function expandQqHistoryQuery(text) { const terms = new Set(historyTerms(text).filter(t => !t.startsWith("@"))); const query = text.normalize("NFKC").toLowerCase(); for (const [, aliases] of concepts)
    if (aliases.some(a => query.includes(a)))
        for (const alias of aliases)
            terms.add(alias); return [...terms].slice(0, 48); }

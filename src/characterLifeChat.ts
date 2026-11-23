import type { Conversation, Message } from './chatTypes';
import { readCharacterLife, lifePrompt } from './characterLife';
/** Read one bounded row. Never advance life or call an API in chat construction. */
export async function characterLifeContext(c: Conversation, path: Message[], budget: number) {
    if (c.mode !== 'daily' || c.worldId || budget < 300)
        return '';
    const query = path.at(-1)?.role === 'user' ? path.at(-1)!.content : '';
    if (!query)
        return '';
    const s = await readCharacterLife(c.characterId);
    if (!s.enabled)
        return '';
    const explicit = /最近怎么样|今天怎么样|在忙什么|忙什么|在做什么|工作|兴趣|心情|生活|休息|读书|进展/.test(query);
    const relevant = s.events.some(e => e.status !== 'done' && e.title.length >= 2 && query.includes(e.title));
    if (!explicit && !relevant)
        return '';
    const text = lifePrompt(s, Math.min(budget, 1800) - 1, query);
    return text ? '\n' + text : '';
}

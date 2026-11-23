import { db } from './store';
import { activeMessages } from './messagePath';
import type { Conversation } from './chatTypes';
/** Shared immutable path avoids cloning a large chat for each low-frequency task. */
export async function lifeSource(owner: string) {
    const character = await db.characters.get(owner);
    if (!character)
        throw Error('角色不存在');
    const c = await db.conversations.where('scopeKey').equals(JSON.stringify([owner, 'daily', ''])).first();
    const rows = c ? await activeMessages(c.id, undefined, true) : [];
    const tail = rows.slice(-30).filter(m => ['user', 'assistant'].includes(m.role));
    const identity = JSON.stringify([c?.id, c?.activeTimelineId, c?.timelineEpoch, tail.map(m => [m.id, m.activeVariantId, m.content, m.createdAt])]);
    const conversation: Conversation = c ?? { id: '', characterId: owner, mode: 'daily', scopeKey: JSON.stringify([owner, 'daily', '']), createdAt: 0, updatedAt: 0 };
    return { character, conversation, tail, count: rows.length, identity };
}
export async function assertLifeSource(source: Awaited<ReturnType<typeof lifeSource>>) {
    const now = await lifeSource(source.character.id);
    if (JSON.stringify(now.character) !== JSON.stringify(source.character))
        throw Error('角色设定已变化，未保存过期结果');
    if (source.conversation.id !== now.conversation.id || source.conversation.activeTimelineId !== now.conversation.activeTimelineId || source.conversation.timelineEpoch !== now.conversation.timelineEpoch || now.count < source.count)
        throw Error('聊天路径已变化，未保存过期结果');
    if (source.conversation.id) {
        const rows = await activeMessages(source.conversation.id, undefined, true);
        const prefix = rows.slice(Math.max(0, source.count - 30), source.count).filter(m => ['user', 'assistant'].includes(m.role));
        if (JSON.stringify(prefix.map(m => [m.id, m.activeVariantId, m.content, m.createdAt])) !== JSON.stringify(source.tail.map(m => [m.id, m.activeVariantId, m.content, m.createdAt])))
            throw Error('聊天来源已变化，未保存过期结果');
    }
}

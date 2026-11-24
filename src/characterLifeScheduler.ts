import { db } from './store';
import { characterLifePrefix, type CharacterLife } from './characterLife';
import { runCharacterLife } from './characterLifeGeneration';
import { generatePrivateNote } from './privateNotesGeneration';
/** One listener/interval for the whole app, at most one owner checked per pass.
 * No offline loops and no promise that iOS runs JavaScript after app closure. */
export function installCharacterLifeScheduler() {
    let stopped = false, running = false, cursor = 0;
    const check = async () => {
        if (stopped || running || document.hidden || !navigator.onLine)
            return;
        running = true;
        try {
            const rows = await db.themes.where(':id').startsWith(characterLifePrefix).toArray();
            if (stopped || document.hidden)
                return;
            const enabled = rows.map(r => (r as any).characterLife as CharacterLife).filter(s => s?.enabled);
            if (!enabled.length)
                return;
            const state = enabled[cursor++ % enabled.length];
            if (!await db.characters.get(state.characterId))
                return;
            await runCharacterLife(state.characterId).catch(()=>{});
            if (!stopped && !document.hidden)
                await generatePrivateNote(state.characterId);
        }
        catch { /* Durable task status is shown in the life/notes UI; no raw provider log. */ }
        finally {
            running = false;
        }
    };
    const timer = setInterval(() => void check(), 60000), resume = () => void check();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    void check();
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume); };
}

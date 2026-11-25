import {acquireAutomationScheduler} from './automationSchedulerLease';
import {enqueueAutomation} from './automationQueue';
import { db } from './store';
import { characterLifePrefix, type CharacterLife } from './characterLife';
import { runCharacterLife } from './characterLifeGeneration';
/** One listener/interval for the whole app, at most one owner checked per pass.
 * No offline loops and no promise that iOS runs JavaScript after app closure. */
function startScheduler() {
    let stopped = false, running = false, queued = false, cursor = 0;
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
            await enqueueAutomation('life:'+state.characterId,()=>stopped||document.hidden?Promise.resolve(null):runCharacterLife(state.characterId,false,Date.now(),()=>!stopped));

        }
        catch { /* Durable task status is shown in the life/notes UI; no raw provider log. */ }
        finally {
            running = false;if(queued&&!stopped){queued=false;resume();}
        }
    };
    const timer = setInterval(() => void check(), 60000), resume = () => {if(running){queued=true;return;}void check();};
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online',resume);
    void check();
    return {wake:resume,stop:() => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume);window.removeEventListener('online',resume); }};
}

export function installCharacterLifeScheduler(){return acquireAutomationScheduler('life',startScheduler);}

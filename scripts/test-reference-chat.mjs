/** Local, deduplicated regression selection for the reference-snapshot refactor.
 * Does not dispatch CI, contact a model, or deploy. Extra Playwright options may
 * be supplied, e.g. node scripts/test-reference-chat.mjs --workers=1. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('..',import.meta.url));
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const core=pkg.scripts['test:chat-regression'].split(' ').filter(x=>x.endsWith('.spec.ts'));
const affected=['chat-large-body','archived-append','chat-draft-isolation','reference-snapshot','reference-restore-schema','snapshot-cost','image-send','keyboard-auto-reply','backup-merge','backup-zip','backup-zip-stream-compat','restore-worker','raw-history-recall','raw-history-round-two','raw-history-input','theme-chat-acceptance','chat-nav-initial','chat-nav-bottom','pwa-viewport'].map(name=>`tests/${name}.spec.ts`);
const files=[...new Set([...core,...affected])].sort();
const result=spawnSync('npx',['playwright','test',...files,'--workers=2',...process.argv.slice(2)],{cwd,stdio:'inherit',env:process.env});
if(result.error)console.error(result.error);
process.exitCode=result.status??1;

import ts from 'typescript';import fs from 'node:fs';
const engine=fs.readFileSync('src/loreEngine.ts','utf8'),types=fs.readFileSync('src/loreTypes.ts','utf8');
const pure=engine.slice(engine.indexOf('export interface LoreMessageRef'),engine.indexOf('export async function loreForConversation'));
const start=types.indexOf('export const loreLimits =');const limits=types.slice(start,types.indexOf('\n};',start)+3);
const normalize=types.slice(types.indexOf('export function normalizeEntry'));
const regex=fs.readFileSync('src/loreRegex.ts','utf8');
const compiler=regex.slice(0,regex.indexOf('export function regexError')).replace('export function','function');
const worker=fs.readFileSync('src/loreRegexWorker.ts','utf8').replace(/^import[^\n]*\n/,'');
const workerSource=ts.transpileModule(compiler+'\n'+worker,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const history=fs.readFileSync('src/rawHistoryTerms.ts','utf8');
const historyCode=ts.transpileModule(history+'\nexport function expandQqHistoryQuery(text:string){const terms=new Set(historyTerms(text).filter(t=>!t.startsWith("@")));const query=text.normalize("NFKC").toLowerCase();for(const [,aliases] of concepts)if(aliases.some(a=>query.includes(a)))for(const alias of aliases)terms.add(alias);return [...terms].slice(0,48);}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const output='// Generated from existing loreEngine.ts / loreTypes.ts by scripts/build-qq-lore.mjs. Do not hand edit.\n'+ts.transpileModule(limits+'\n'+normalize+'\n'+pure,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText+'\nexport const regexWorkerSource='+JSON.stringify(workerSource)+';\n'+historyCode;
if(process.argv.includes('--check')){if(fs.readFileSync('supabase/functions/_shared/qqLorePlan.mjs','utf8')!==output)throw Error('QQ lore runtime differs from canonical app source');}
else fs.writeFileSync('supabase/functions/_shared/qqLorePlan.mjs',output);

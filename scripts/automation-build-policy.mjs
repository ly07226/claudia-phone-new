import {pathToFileURL} from 'node:url';
const branch='feature/dual-automation-api';
const normalized=value=>String(value??'').replace(/^refs\/heads\//,'');
/** Only this draft feature/PR is blocked. A production main build remains normal. */
export function ignoreAutomationBuild(env){
 if(env.CONTEXT==='production'&&normalized(env.BRANCH)==='main'||env.VERCEL_ENV==='production'&&normalized(env.VERCEL_GIT_COMMIT_REF)==='main')return false;
 return [env.BRANCH,env.HEAD,env.VERCEL_GIT_COMMIT_REF].some(value=>normalized(value)===branch)||env.CONTEXT==='deploy-preview'&&String(env.REVIEW_ID)==='109'||env.VERCEL_ENV==='preview'&&String(env.VERCEL_GIT_PULL_REQUEST_ID)==='109';
}
export function automationBuildExit(mode,env){
 if(mode==='ignore')return ignoreAutomationBuild(env)?0:1;
 if(mode==='prebuild')return (['true','1'].includes(env.NETLIFY)||env.VERCEL==='1')&&ignoreAutomationBuild(env)?2:0;
 throw Error('Unknown automation build policy mode');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const mode=process.argv[2]??'ignore';process.exitCode=automationBuildExit(mode,process.env);
 if(mode==='prebuild'&&process.exitCode===2)console.error('This automation draft preview is disabled. Stopped before TypeScript/Vite; no new artifact may be published.');
}

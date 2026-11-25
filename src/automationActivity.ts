import type {ApiConfig} from './api';
/** In-memory credentials are never emitted into queue diagnostics. */
export const automationRequest = Symbol('automation-request');
const foreground=new Set<{config:ApiConfig;key:string}>();
export function sameApi(a:ApiConfig,ak:string,b:ApiConfig,bk:string){return a.baseUrl.replace(/\/+$/,'')===b.baseUrl.replace(/\/+$/,'')&&ak===bk;}
export function trackForeground(config:ApiConfig,key:string){const entry={config,key};foreground.add(entry);return()=>foreground.delete(entry);}
export function foregroundUses(config:ApiConfig,key:string){return [...foreground].some(e=>sameApi(config,key,e.config,e.key));}

/** Internal control flow only: one existing provider role-compatibility retry. */
export class AutomationRoleFallback extends Error {constructor(public messages:import('./chatTypes').ContextMessage[]){super('automation-role-fallback')}}

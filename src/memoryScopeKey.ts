import type {MemoryScope} from './memoryTypes';
/** Independent of JSON key ordering after canonical backups/imports. */
export const memoryScopeKey=(s:MemoryScope)=>JSON.stringify([s.conversationId,s.characterId,s.mode,s.spaceId,s.worldId??null,s.mode==='world'?s.timelineId:null,s.mode==='world'?s.epoch:null]);

import {phaseTalkSources} from './phaseTalkSources';
import type {Phase,PhaseSettings} from './engine';
export type TalkMode='sweet'|'dirty';
export const talkMode=(s:PhaseSettings):TalkMode|undefined=>s.instructionMode==='character'?undefined:s.commandMode?'dirty':s.sweetMode?'sweet':undefined;
export function talkInstructions(mode:TalkMode,phase?:Phase){return phaseTalkSources.find(x=>x.mode===mode)!.paragraphs.flatMap(row=>'phase' in row&&(!phase||row.phase===phase)?[{id:`source:${mode}:${row.paragraph}`,phase:row.phase,text:row.text,marker:'marker' in row?row.marker:undefined}]:[]);}

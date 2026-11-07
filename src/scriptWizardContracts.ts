import type {ScriptWizardDraft} from './scriptWizardDraft';
import type {PacingRecommendation,OpeningRecommendation,GeneratedWizardCharacter} from './wizardAssistanceTypes';
/** User-initiated adapters implemented through requestWizardAssistance. */
export interface ScriptWizardAssistance {
 recommendPacing(input:Readonly<ScriptWizardDraft>,signal:AbortSignal):Promise<PacingRecommendation[]>;
 recommendOpening(input:Readonly<ScriptWizardDraft>,signal:AbortSignal):Promise<OpeningRecommendation[]>;
 suggestCharacters(input:Readonly<ScriptWizardDraft>,signal:AbortSignal):Promise<GeneratedWizardCharacter>;
}
/** Implemented by createWizardWorld; no model calls. The draft's stable creationToken
 * is committed with the world for cross-tab/reload idempotency. */
export interface ScriptWizardCreator {
 createWorld(input:Readonly<ScriptWizardDraft>):Promise<{id:string}>;
}

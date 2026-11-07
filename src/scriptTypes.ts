export type StoryPerspective='first'|'second'|'third';
export const storyPerspectives={first:'第一人称',second:'第二人称',third:'第三人称'} as const;
/** World gameplay configuration; never changes Conversation.mode. */
export interface ScriptConfig {
  version: 1;
  playMode: 'story' | 'everyday';
  opening: string;
  direction?: string;
  perspective?: StoryPerspective;
  definitionRevision: number;
  /** Optional wizard metadata; no chat, identity or branch state. */
  pace?: "slow" | "balanced" | "compact" | "custom";
  customPace?: string;
  creation?: {version:1;token:string;fingerprint:string};
}
export const newScriptConfig = (): ScriptConfig => ({version:1,playMode:'story',opening:'',definitionRevision:1});

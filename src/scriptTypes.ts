/** World gameplay configuration; never changes Conversation.mode. */
export interface ScriptConfig {
  version: 1;
  playMode: 'story' | 'everyday';
  opening: string;
  direction?: string;
  definitionRevision: number;
}
export const newScriptConfig = (): ScriptConfig => ({version:1,playMode:'story',opening:'',definitionRevision:1});

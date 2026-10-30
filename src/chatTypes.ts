export interface Conversation {
  id: string;
  scopeKey: string;
  characterId: string;
  mode: "daily" | "world";
  worldId?: string;
  apiConfigId?: string;
  createdAt: number;
  updatedAt: number;
  sendingToken?: string;
  sendingUntil?: number;
}
export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: number;
  regeneratedFrom?: string;
  editedFrom?: string;
}
export interface WorldCharacterProfile {
  id: string;
  worldId: string;
  characterId: string;
  setting: string;
}
export interface ContextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

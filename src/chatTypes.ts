export type ChatBackground = { kind: "color"; color: string } | { kind: "image"; assetId: string };
export interface ChatSettings {
  remark?: string;
  pinned?: boolean;
  pinnedAt?: number;
  muted?: boolean;
  background?: ChatBackground;
}
export interface Conversation {
  activeTimelineId?: string;
  timelineEpoch?: number;
  chatSettings?: ChatSettings;
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
  activeVariantId?: string;
  archived?: boolean;
  userEdited?: boolean;
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
export interface MessageVariant {
  id: string;
  conversationId: string;
  messageId: string;
  content: string;
  source: "legacy" | "generated";
  userEdited?: boolean;
  createdAt: number;
}
export interface MessageRevision {
  id: string;
  conversationId: string;
  messageId: string;
  variantId?: string;
  content: string;
  createdAt: number;
}
export interface ConversationSnapshot {
  timelineId?: string;
  headNodeId?: string;
  timelineEpoch?: number;
  id: string;
  conversationId: string;
  reason: "edit" | "switch" | "withdraw" | "delete" | "regenerate" | "restore";
  createdAt: number;
  messages: Message[];
  variants: MessageVariant[];
}

export interface MemoryTimeline {
  id: string;
  conversationId: string;
  characterId: string;
  spaceId: string;
  worldId?: string;
  epoch: number;
  parentTimelineId?: string;
  forkNodeId?: string;
  parentRevisionAtFork?: number;
  headNodeId?: string;
  revision: number;
  createdAt: number;
  status: "live" | "invalidated";
  reason: "legacy-root" | "append" | "edit" | "switch" | "regenerate" | "delete" | "withdraw" | "restore" | "legacy-snapshot";
}
export interface ConversationPathNode {
  id: string;
  conversationId: string;
  parentNodeId: string;
  messageId: string;
  variantId?: string;
  role: Message["role"];
  message: Message;
  fingerprint: string;
  createdAt: number;
}

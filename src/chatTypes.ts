import type {MemorySummaryState} from './memorySummaryTypes';
import type {MemoryStore} from './memoryTypes';
import type {BubblePart,BubbleDeletion} from './messageBubbles';
export type ChatBackground = { kind: "color"; color: string } | { kind: "image"; assetId: string };
export interface ChatSettings {
  continuousSend?: boolean;
  keyboardAutoReply?: boolean;
  followRealTime?: boolean;
  proactiveEnabled?: boolean;
  proactiveHours?: number;
  proactiveProbability?: number;
  proactiveEnabledAt?: number;
  proactiveAttemptFor?: number;
  proactiveAttemptAt?: number;
  proactiveError?: string;
  proactiveUnreadAt?: number;
  remark?: string;
  pinned?: boolean;
  pinnedAt?: number;
  muted?: boolean;
  background?: ChatBackground;
}
export interface Conversation {
  /** Latest visible bubble, maintained with timeline commits; not a memory summary. */
  chatPreview?: {timelineId?:string;headNodeId?:string;messageId?:string;content:string;createdAt?:number};
  /** Opt-in WeChat bridge cursor, committed with the daily timeline. */
  wechatSync?: {bindingId:string;nextSeq:number};
  chatEventReceipts?: import('./phasePlay/chatLink').ChatEventReceipt[];
  /** Independent memory journal. Not persona, lore, messages, or prompt injection. */
  memoryStore?: MemoryStore;
  memorySummary?: MemorySummaryState;
  /** Durable, independently recoverable second-pass core summary attempt. */
  memoryCoreAttempt?: {error?:string;attempts?:number;anchorReceiptId:string;sourceReceiptIds:string[];status:'running'|'failed'|'succeeded';startedAt:number;finishedAt?:number};
  smartTimeMemories?: import('./smartTimeMemory').SmartTimeMemory[];
  dailyDigestAttempt?: {error?:string;tries?:number;token?:string;scope:import('./memoryTypes').MemoryScope;startDay:string;endDay:string;status:'running'|'failed';startedAt:number};
  dailyDigestSettings?: {enabled:boolean;days:1|2|3|7|14};
  dailyDigests?: import('./dailyDigest').DailyDigest[];
  dailyDigestCheckpointArchive?: import('./dailyDigest').DailyDigestCheckpoint[];
  dailyDigestCheckpoint?: import('./dailyDigest').DailyDigestCheckpoint;
  summaryApiConfigId?: string;
  dedicatedSummaryApi?: import('./dedicatedSummaryApi').DedicatedSummaryApi;
  activeTimelineId?: string;
  timelineEpoch?: number;
  chatSettings?: ChatSettings;
  imageDrafts?: Record<string,{assetIds:string[];text:string;epoch:number}>;
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
export interface MessageQuote {
  version:1; conversationId:string; timelineId:string; epoch:number;
  messageId:string; variantId?:string; role:"user"|"assistant"; part:BubblePart;
}
export interface Message {
  replyInterruption?: import("./chatCompletion").ReplyInterruption;
  replyTo?: MessageQuote;
  bubbleDeletion?: BubbleDeletion;
  /** Optional authored character inner monologue, never model reasoning. */
  heartVoice?: string;
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: number;
  attachments?: {assetId:string}[];
  activeVariantId?: string;
  archived?: boolean;
  userEdited?: boolean;
  regeneratedFrom?: string;
  editedFrom?: string;
}
export interface WorldCharacterProfile {
  /** Optional wizard cast order; zero denotes the primary role. */
  scriptOrder?: number;
  id: string;
  worldId: string;
  characterId: string;
  setting: string;
}
export interface ContextImage { mimeType: "image/jpeg"|"image/png"|"image/webp"; data: string }
export interface ContextMessage {
  images?: ContextImage[];
  role: "system" | "user" | "assistant";
  content: string;
}
export interface MessageVariant {
  heartVoice?: string;
  replyInterruption?: import("./chatCompletion").ReplyInterruption;
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

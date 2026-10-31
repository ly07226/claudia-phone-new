export const lorePositions = [
  "before-profile",
  "after-profile",
  "before-conversation",
  "after-conversation",
  "at-depth",
] as const;
export type LorePosition = (typeof lorePositions)[number];
export interface Lorebook {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  sourceType: "native" | "imported";
  global: boolean;
  worldIds: string[];
  scanDepth: number;
  charBudget: number;
  createdAt: number;
  updatedAt: number;
  rawMetadata?: Record<string, unknown>;
}
export interface LoreEntry {
  id: string;
  lorebookId: string;
  title: string;
  content: string;
  primaryKeys: string[];
  secondaryKeys: string[];
  enabled: boolean;
  constant: boolean;
  triggerMode?: "instant" | "history";
  scanAssistant?: boolean;
  selective: boolean;
  selectiveLogic: 0 | 1 | 2 | 3;
  priority: number;
  insertionPosition: LorePosition;
  insertionDepth?: number;
  role?: "system" | "user" | "assistant";
  regex?: boolean;
  useProbability?: boolean;
  probability?: number;
  scanDepth: number | null;
  caseSensitive: boolean;
  createdAt: number;
  updatedAt: number;
  compatibilityIssues: string[];
  rawMetadata?: Record<string, unknown>;
}
export interface LorePreview {
  format: "Claudia Phone" | "SillyTavern / Tavern";
  book: Lorebook;
  entries: LoreEntry[];
  total: number;
  valid: number;
  issues: number;
  warnings: string[];
}
export const loreLimits = {
  fileBytes: 5 * 1024 * 1024,
  entries: 3000,
  contentChars: 20000,
  totalChars: 2000000,
  promptChars: 8000,
  scanMessages: 30,
};
export const newBook = (): Lorebook => ({
  id: crypto.randomUUID(),
  name: "",
  description: "",
  enabled: true,
  sourceType: "native",
  global: false,
  worldIds: [],
  scanDepth: 10,
  charBudget: 4000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
export const newEntry = (lorebookId: string): LoreEntry => ({
  id: crypto.randomUUID(),
  lorebookId,
  title: "",
  content: "",
  primaryKeys: [],
  secondaryKeys: [],
  enabled: true,
  constant: false,
  triggerMode: "instant",
  scanAssistant: true,
  selective: false,
  selectiveLogic: 0,
  priority: 100,
  insertionPosition: "after-profile",
  insertionDepth: 0,
  role: "system",
  regex: false,
  useProbability: false,
  probability: 100,
  scanDepth: null,
  caseSensitive: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  compatibilityIssues: [],
});

/** Missing v4 extension fields retain 2.3 behavior, without writing a migration. */
export function normalizeEntry(e: LoreEntry): LoreEntry {
  return {
    ...e,
    triggerMode: e.triggerMode ?? "history",
    scanAssistant: e.scanAssistant ?? true,
    insertionDepth: e.insertionDepth ?? 0,
    role: e.role ?? "system",
    regex: e.regex ?? false,
    useProbability: e.useProbability ?? false,
    probability: e.probability ?? 100,
    compatibilityIssues: e.compatibilityIssues ?? [],
  };
}

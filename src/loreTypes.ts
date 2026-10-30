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
  selective: boolean;
  selectiveLogic: 0 | 1 | 2 | 3;
  priority: number;
  insertionPosition: "before-profile" | "after-profile";
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
  selective: false,
  selectiveLogic: 0,
  priority: 100,
  insertionPosition: "after-profile",
  scanDepth: null,
  caseSensitive: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  compatibilityIssues: [],
});

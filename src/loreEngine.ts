import { db } from "./store";
import {
  loreLimits,
  normalizeEntry,
  type Lorebook,
  type LoreEntry,
} from "./loreTypes";
import { evaluateRegex, type RegexHits } from "./loreRegex";
import type { Conversation, Message, ContextMessage } from "./chatTypes";
const scan = (e: LoreEntry, b: Lorebook, h: Message[]) =>
  h
    .slice(-(e.scanDepth ?? b.scanDepth))
    .map((m) => m.content)
    .join("\n");
export function entryActive(
  raw: LoreEntry,
  b: Lorebook,
  h: Message[],
  random: () => number = Math.random,
  regex?: RegexHits,
) {
  const e = normalizeEntry(raw);
  if (!b.enabled || !e.enabled || e.compatibilityIssues.length) return false;
  let matches = e.constant;
  if (!matches) {
    const text = scan(e, b, h);
    const hay = e.caseSensitive ? text : text.toLowerCase();
    const hit = (key: string) =>
      !!key && hay.includes(e.caseSensitive ? key : key.toLowerCase());
    if (e.regex && (!regex || regex.error)) return false;
    const primary = e.regex ? regex!.primary : e.primaryKeys.map(hit);
    const secondary = e.regex ? regex!.secondary : e.secondaryKeys.map(hit);
    matches = primary.some(Boolean);
    if (matches && e.selective && e.secondaryKeys.length) {
      switch (e.selectiveLogic) {
        case 0:
          matches = secondary.some(Boolean);
          break;
        case 1:
          matches = !secondary.every(Boolean);
          break;
        case 2:
          matches = !secondary.some(Boolean);
          break;
        case 3:
          matches = secondary.every(Boolean);
          break;
        default:
          matches = false;
      }
    }
  }
  if (!matches) return false;
  if (!e.useProbability) return true;
  const p = e.probability!;
  return p >= 100 || (p > 0 && random() < p / 100);
}
export interface LoreCandidate {
  entry: LoreEntry;
  book: Lorebook;
}
/** Pure, deterministic with injected random and regex results; no metadata enters the prompt. */
export function planLore(
  candidates: LoreCandidate[],
  history: Message[],
  remainingBudget = loreLimits.promptChars,
  random: () => number = Math.random,
  regex: Record<string, RegexHits> = {},
) {
  const sorted = candidates
    .map((c) => ({ ...c, entry: normalizeEntry(c.entry) }))
    .sort(
      (a, b) =>
        b.entry.priority - a.entry.priority ||
        a.entry.createdAt - b.entry.createdAt ||
        (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0),
    );
  const selected: LoreEntry[] = [];
  const used = new Map<string, number>();
  let total = 0;
  for (const { entry, book } of sorted) {
    if (!entryActive(entry, book, history, random, regex[entry.id])) continue;
    const cost = entry.content.length + 2;
    const bookUsed = used.get(book.id) || 0;
    if (
      total + cost > Math.min(loreLimits.promptChars, remainingBudget) ||
      bookUsed + cost > book.charBudget
    )
      continue;
    used.set(book.id, bookUsed + cost);
    total += cost;
    selected.push(entry);
  }
  return {
    entries: selected,
    activated: selected.map((e) => e.id),
    regexErrors: Object.fromEntries(
      Object.entries(regex)
        .filter(([, r]) => r.error)
        .map(([id, r]) => [id, r.error]),
    ),
  };
}
export function injectLore(
  system: string,
  history: ContextMessage[],
  entries: LoreEntry[],
): ContextMessage[] {
  const sorted = entries.map(normalizeEntry);
  const own = (e: LoreEntry): ContextMessage => ({
    role: e.role!,
    content: e.content,
  });
  // Preserve legacy default System profile placement inside the first system message.
  const profileEntries = sorted.filter(
    (e) =>
      e.insertionPosition === "before-profile" ||
      e.insertionPosition === "after-profile",
  );
  const splitProfile = profileEntries.some((e) => e.role !== "system");
  const before = profileEntries.filter(
    (e) => e.insertionPosition === "before-profile",
  );
  const after = profileEntries.filter(
    (e) => e.insertionPosition === "after-profile",
  );
  const prefix: ContextMessage[] = splitProfile
    ? [
        { role: "system", content: "以下是当前会话的角色与设定资料。" },
        ...before.map(own),
        { role: "system", content: system },
        ...after.map(own),
      ]
    : [
        {
          role: "system",
          content: [
            ...before.map((e) => e.content),
            system,
            ...after.map((e) => e.content),
          ].join("\n\n"),
        },
      ];
  const slots: Array<ContextMessage[]> = Array.from(
    { length: history.length + 1 },
    () => [],
  );
  for (const e of sorted) {
    if (
      e.insertionPosition === "before-profile" ||
      e.insertionPosition === "after-profile"
    ) {
      continue;
    }
    const index =
      e.insertionPosition === "after-conversation"
        ? history.length
        : e.insertionPosition === "at-depth"
          ? Math.max(0, history.length - e.insertionDepth!)
          : 0;
    slots[index].push(own(e));
  }
  return [
    ...prefix,
    ...slots.flatMap((slot, i) =>
      i < history.length ? [...slot, history[i]] : slot,
    ),
  ];
}
export async function loreForConversation(
  c: Conversation,
  history: Message[],
  remainingBudget = loreLimits.promptChars,
  random: () => number = Math.random,
) {
  const books = await db.lorebooks
    .filter(
      (b) =>
        b.enabled &&
        (b.global ||
          (c.mode === "world" &&
            !!c.worldId &&
            b.worldIds.includes(c.worldId))),
    )
    .toArray();
  const candidates: LoreCandidate[] = [];
  for (const book of books) {
    const entries = await db.loreEntries
      .where("lorebookId")
      .equals(book.id)
      .toArray();
    for (const raw of entries)
      candidates.push({ entry: normalizeEntry(raw), book });
  }
  const jobs = candidates
    .filter(
      ({ entry: e, book: b }) =>
        b.enabled &&
        e.enabled &&
        !e.compatibilityIssues.length &&
        e.regex &&
        !e.constant,
    )
    .map(({ entry: e, book: b }) => ({
      id: e.id,
      text: scan(e, b, history),
      primary: e.primaryKeys,
      secondary: e.secondaryKeys,
      caseSensitive: e.caseSensitive,
    }));
  return planLore(
    candidates,
    history,
    remainingBudget,
    random,
    await evaluateRegex(jobs),
  );
}

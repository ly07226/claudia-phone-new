import { db } from "./store";
import { loreLimits, type Lorebook, type LoreEntry } from "./loreTypes";
import type { Conversation, Message } from "./chatTypes";
export function entryActive(e: LoreEntry, book: Lorebook, history: Message[]) {
  if (!book.enabled || !e.enabled || e.compatibilityIssues.length) return false;
  if (e.constant) return true;
  const text = history
    .slice(-(e.scanDepth ?? book.scanDepth))
    .map((m) => m.content)
    .join("\n");
  const hay = e.caseSensitive ? text : text.toLowerCase();
  const hit = (key: string) =>
    !!key && hay.includes(e.caseSensitive ? key : key.toLowerCase());
  if (!e.primaryKeys.some(hit)) return false;
  if (!e.selective || !e.secondaryKeys.length) return true;
  const hits = e.secondaryKeys.map(hit);
  switch (e.selectiveLogic) {
    case 0:
      return hits.some(Boolean);
    case 1:
      return !hits.every(Boolean);
    case 2:
      return !hits.some(Boolean);
    case 3:
      return hits.every(Boolean);
    default:
      return false;
  }
}
/** No recursion: lore content never triggers more entries, and only the current history is scanned. */
export async function loreForConversation(
  c: Conversation,
  history: Message[],
  remainingBudget = loreLimits.promptChars,
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
  const candidates: { entry: LoreEntry; book: Lorebook }[] = [];
  for (const book of books) {
    const entries = await db.loreEntries
      .where("lorebookId")
      .equals(book.id)
      .toArray();
    for (const entry of entries)
      if (entryActive(entry, book, history)) candidates.push({ entry, book });
  }
  candidates.sort(
    (a, b) =>
      b.entry.priority - a.entry.priority ||
      a.entry.createdAt - b.entry.createdAt ||
      a.entry.id.localeCompare(b.entry.id),
  );
  const used = new Map<string, number>();
  let total = 0;
  const before: string[] = [];
  const after: string[] = [];
  const activated: string[] = [];
  for (const { entry, book } of candidates) {
    const cost = entry.content.length + 2;
    const bookUsed = used.get(book.id) || 0;
    if (
      total + cost > Math.min(loreLimits.promptChars, remainingBudget) ||
      bookUsed + cost > book.charBudget
    )
      continue;
    used.set(book.id, bookUsed + cost);
    total += cost;
    activated.push(entry.id);
    (entry.insertionPosition === "before-profile" ? before : after).push(
      entry.content,
    );
  }
  return { before: before.join("\n\n"), after: after.join("\n\n"), activated };
}

import type { MessageVariant } from "./chatTypes";

// Canonicalize object keys, preserving array order and all JSON-persisted fields.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => [k, canonical(v)]));
  }
  return value;
}

export interface SnapshotVersionRecord {
  key: string;
  variant: MessageVariant;
}

export function snapshotVersionIdentity(variant: MessageVariant): string {
  return JSON.stringify(canonical(variant));
}

/** Intern complete versions, not mutable variant IDs or message text alone. */
export function internSnapshotVersions(variants: readonly MessageVariant[], pool: Map<string, SnapshotVersionRecord>, identities: Map<string,string>): string[] {
  return variants.map(variant => {
    const identity = snapshotVersionIdentity(variant);
    const existing = identities.get(identity);
    if (existing !== undefined) {
      const record = pool.get(existing);
      if (!record || snapshotVersionIdentity(record.variant) !== identity) throw Error("快照版本索引不一致。");
      return existing;
    }
    const key = crypto.randomUUID();
    pool.set(key, { key, variant: structuredClone(variant) });
    identities.set(identity, key);
    return key;
  });
}

export function resolveSnapshotVersions(conversationId: string, keys: readonly string[], pool: ReadonlyMap<string, SnapshotVersionRecord>): MessageVariant[] {
  return keys.map(key => {
    const record = pool.get(key);
    if (!record || record.key !== key || record.variant.conversationId !== conversationId) throw Error("快照版本缺失或跨会话。");
    return structuredClone(record.variant);
  });
}

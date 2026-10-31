/** Only the permanent daily space. Missing metadata preserves legacy friendship. */
export interface DailyFriendship {
  status: "friend" | "deleted" | "pending" | "rejected" | "not-added";
  deletion?: { id: string; at: number; by: "user" };
  application?: {
    id: string;
    deletionId: string;
    createdAt: number;
    reason: string;
    source: "local-rule";
    resolvedAt?: number;
  };
}
export function validFriendship(value: unknown): value is DailyFriendship {
  if (!value || typeof value !== "object") return false;
  const f = value as DailyFriendship;
  if (!["friend", "deleted", "pending", "rejected", "not-added"].includes(f.status)) return false;
  if (f.deletion && (typeof f.deletion.id !== "string" || !f.deletion.id || !Number.isFinite(f.deletion.at) || f.deletion.by !== "user")) return false;
  if (["deleted", "pending", "rejected"].includes(f.status) && !f.deletion) return false;
  const a = f.application;
  if (a && (!f.deletion || a.deletionId !== f.deletion.id || typeof a.id !== "string" || !a.id || !Number.isFinite(a.createdAt) || typeof a.reason !== "string" || a.source !== "local-rule" || (a.resolvedAt !== undefined && !Number.isFinite(a.resolvedAt)))) return false;
  return !["pending", "rejected"].includes(f.status) || !!a;
}

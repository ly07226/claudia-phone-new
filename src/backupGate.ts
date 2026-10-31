import { BackupError } from "./backupFormat";
import type Dexie from "dexie";
let owner: symbol | null = null;
export function backupIsLocked() {
  return owner !== null;
}
export function acquireBackupGuard() {
  if (owner) throw new BackupError("另一个备份正在运行，请稍后重试。");
  const token = Symbol();
  owner = token;
  return () => {
    if (owner === token) owner = null;
  };
}
/** Admission control only; existing message/API/lore write rules are unchanged. */
export function installBackupGuard(database: Dexie) {
  database.use({
    stack: "dbcore",
    name: "backup-maintenance-v1",
    create(down) {
      return {
        ...down,
        table(name) {
          const table = down.table(name);
          return {
            ...table,
            mutate(request) {
              if (backupIsLocked())
                return Promise.reject(
                  new Error(
                    "本标签正在制作备份快照，写入已暂停，请备份结束后重试。",
                  ),
                );
              return table.mutate(request);
            },
          };
        },
      };
    },
  });
}
const tabId = crypto.randomUUID();
let presence: BroadcastChannel | undefined;
let users = 0;
const probes = new Map<string, Set<string>>();
const arrivals = new Set<() => void>();
export function startBackupPresence() {
  users++;
  if (!presence && typeof BroadcastChannel !== "undefined") {
    presence = new BroadcastChannel("claudia-backup-presence-v1");
    presence.onmessage = (event) => {
      const m = event.data;
      if (m?.id === tabId) return;
      if (m?.type === "probe" && typeof m.nonce === "string")
        presence?.postMessage({ type: "present", id: tabId, nonce: m.nonce });
      if (m?.type === "present") probes.get(m.nonce)?.add(m.id);
      if (m?.type === "hello") for (const notify of arrivals) notify();
    };
    presence.postMessage({ type: "hello", id: tabId });
  }
  return () => {
    if (--users === 0) {
      presence?.close();
      presence = undefined;
    }
  };
}
export function watchBackupArrivals(notify: () => void) {
  arrivals.add(notify);
  return () => {
    arrivals.delete(notify);
  };
}
export async function checkBackupClients() {
  const nonce = crypto.randomUUID();
  const known = new Set<string>();
  probes.set(nonce, known);
  presence?.postMessage({ type: "probe", id: tabId, nonce });
  await new Promise((resolve) => setTimeout(resolve, 250));
  probes.delete(nonce);
  if (known.size)
    throw new BackupError(
      "检测到其他 Claudia Phone 标签页，请关闭所有其他标签页和独立 PWA 后重试。",
    );
  const worker = navigator.serviceWorker?.controller;
  if (!worker)
    return "无法自动枚举旧客户端；用户需确认已关闭其他标签页及独立 PWA。快照仍由原生只读事务保护。";
  const count = await new Promise<number | null>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, 800);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(typeof event.data?.count === "number" ? event.data.count : null);
    };
    worker.postMessage({ type: "claudia-backup-clients-v1" }, [channel.port2]);
  });
  if (count !== null && count > 1)
    throw new BackupError(
      "检测到其他同源窗口或 PWA，请关闭后重试；不会假定旧客户端已被暂停。",
    );
  return count === 1
    ? "服务工作线程当前仅检测到本窗口；不代表旧缓存永久退役。"
    : "旧服务工作线程无法确认窗口数，请手动关闭其他标签页和独立 PWA；不宣称已完成协调。";
}

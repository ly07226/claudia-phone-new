import { providers, validateConfig, type ApiConfig } from "./api";
import { db } from "./store";

/** Local completeness only; this does not validate credentials with a provider. */
export function usableApi(config: ApiConfig, key: string) {
  const supported = !!providers[config.provider]?.request ||
    (config.provider === "custom" && ["openai-chat", "gemini"].includes(config.protocol || ""));
  return config.enabled && supported && !validateConfig({ ...config, isDefault: false }, key);
}

export async function reconcileApiDefault() {
  return db.transaction("rw", [db.apiConfigs, db.apiCredentials], async () => {
    const rows = await db.apiConfigs.toArray();
    const credentials = new Map((await db.apiCredentials.toArray()).map(c => [c.configId, c.apiKey]));
    const available = rows.filter(c => usableApi(c, credentials.get(c.id) || ""))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const chosen = available.find(c => c.isDefault) || available[0];
    let changed = false;
    for (const row of rows) {
      const isDefault = row.id === chosen?.id;
      if (row.isDefault !== isDefault) {
        await db.apiConfigs.update(row.id, { isDefault });
        changed = true;
      }
    }
    return { config: chosen ? { ...chosen, isDefault: true } : undefined, availableIds: available.map(c => c.id), changed };
  });
}

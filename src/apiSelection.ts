import { providers, validateConfig, type ApiConfig } from "./api";
import { db } from "./store";

/** Local completeness only; this does not validate credentials with a provider. */
export function usableApi(config: ApiConfig, key: string) {
  const supported = !!providers[config.provider]?.request ||
    (config.provider === "custom" && ["openai-chat", "gemini"].includes(config.protocol || ""));
  return config.enabled && supported && !validateConfig({ ...config, isDefault: false }, key);
}

/** Select an existing complete connection atomically; never rewrite credentials
 * or alter in-flight requests / explicit character and conversation bindings. */
export async function selectApiDefault(id: string) {
  return db.transaction("rw", [db.apiConfigs, db.apiCredentials], async () => {
    const config = await db.apiConfigs.get(id);
    if (!config) throw Error("该 API 配置已不存在，请刷新列表后重试。");
    const credential = await db.apiCredentials.get(id);
    if (!usableApi(config, credential?.apiKey || ""))
      throw Error("无法切换：配置需启用，且 API Key、HTTPS 地址、模型、参数和协议必须完整有效。请编辑检查；原选择未改变。");
    await db.apiConfigs.filter(c => !!c.isDefault && c.id !== id).modify({ isDefault: false });
    await db.apiConfigs.update(id, { isDefault: true });
    return db.apiConfigs.toCollection().sortBy('createdAt');
  });
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

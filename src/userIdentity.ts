import { db, usePhone, type Theme } from "./store";
import type { SpaceId } from "./spaces";
export interface UserIdentity {
  name: string;
  bio: string;
  customSetting: string;
  avatar?: string;
  gender?: string;
  age?: number | string;
  occupation?: string;
  updatedAt?: number;
  [field: string]: unknown;
}
/** No cross-space fallback, and no implicit prompt injection. */
export function identityFor(theme: Theme, spaceId: SpaceId): UserIdentity {
  return { name: "你", bio: "", customSetting: "", ...theme.userIdentities?.[spaceId] };
}
export async function saveIdentity(spaceId: SpaceId, draft: UserIdentity) {
  if (!draft.name.trim()) throw Error("请填写名字。");
  await db.transaction("rw", [db.themes, db.worlds, db.assets], async () => {
    if (spaceId !== "daily" && !(await db.worlds.get(spaceId.slice(6)))) throw Error("此世界已不存在，未保存身份。");
    if (draft.avatar && !(await db.assets.get(draft.avatar))) throw Error("头像资源不存在，请重新上传。");
    const theme = await db.themes.get("global");
    if (!theme) throw Error("无法读取本地配置，未保存身份。");
    const previous = theme.userIdentities || {};
    await db.themes.update(theme.id, { userIdentities: { ...previous, [spaceId]: { ...previous[spaceId], ...draft, name: draft.name.trim(), updatedAt: Date.now() } } });
  });
  await usePhone.getState().reload();
}

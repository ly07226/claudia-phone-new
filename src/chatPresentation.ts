import type { Character } from "./store";
/** There is currently no remark or world-specific name field. Never overwrite the character name. */
export function chatDisplayName(character?: Character) {
  return character?.name?.trim() || "未命名角色";
}

import Dexie, { type Table } from "dexie";
import { create } from "zustand";
import type { ApiConfig, ApiCredential } from "./api";
export interface World {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}
export interface Character {
  id: string;
  worldId: string;
  name: string;
  persona: string;
  avatar?: string;
  /** Absent means use the enabled default API configuration. */
  apiConfigId?: string;
}
export interface DesktopPage {
  id: string;
  order: number;
}
export interface DesktopItem {
  id: string;
  kind: "app" | "widget";
  app?: string;
  widget?: "quote" | "calendar" | "note";
  pageId: string;
  position: number;
  size: 1 | 2 | 4;
  icon?: string;
}
export interface Theme {
  id: string;
  worldId?: string;
  color: string;
  font: string;
  iconStyle: "rounded" | "squircle";
  opacity: number;
  blur: number;
  wallpaper?: string;
}
export interface Asset {
  id: string;
  type: "wallpaper" | "avatar" | "icon";
  data: string;
  createdAt: number;
}
class PhoneDB extends Dexie {
  apiConfigs!: Table<ApiConfig>;
  apiCredentials!: Table<ApiCredential>;
  worlds!: Table<World>;
  characters!: Table<Character>;
  pages!: Table<DesktopPage>;
  items!: Table<DesktopItem>;
  themes!: Table<Theme>;
  assets!: Table<Asset>;
  constructor() {
    super("claudia-phone");
    this.version(1).stores({
      worlds: "id,createdAt",
      characters: "id,worldId",
      pages: "id,order",
      items: "id,pageId,position",
      themes: "id,worldId",
      assets: "id,type",
    });
    // Additive migration: all version 1 stores and records are retained.
    this.version(2).stores({
      apiConfigs: "id,provider",
      apiCredentials: "configId",
    });
  }
}
export const db = new PhoneDB();
export const apps = [
  "聊天",
  "手记",
  "音乐",
  "日历",
  "查手机",
  "购物",
  "阅读",
  "在场",
  "设置",
  "主题编辑器",
  "世界管理",
  "角色管理",
];
export const defaultTheme: Theme = {
  id: "global",
  color: "#c5d1c3",
  font: "sans",
  iconStyle: "rounded",
  opacity: 0.42,
  blur: 18,
};
export const defaultItems = (): DesktopItem[] => [
  {
    id: "quote",
    kind: "widget",
    widget: "quote",
    pageId: "page-1",
    position: 0,
    size: 4,
  },
  ...apps.map((app, i) => ({
    id: `app-${i}`,
    kind: "app" as const,
    app,
    pageId: "page-1",
    position: i + 1,
    size: 1 as const,
  })),
];
interface State {
  ready: boolean;
  error: string;
  editing: boolean;
  activeApp: string | null;
  pageId: string;
  worldId: string;
  worlds: World[];
  characters: Character[];
  pages: DesktopPage[];
  items: DesktopItem[];
  theme: Theme;
  assets: Asset[];
  set: (s: Partial<State>) => void;
  init: () => Promise<void>;
  saveDesktop: (items: DesktopItem[], pages?: DesktopPage[]) => Promise<void>;
  saveTheme: (theme: Theme) => Promise<void>;
  reload: () => Promise<void>;
}
export const usePhone = create<State>((set, get) => ({
  ready: false,
  error: "",
  editing: false,
  activeApp: null,
  pageId: "page-1",
  worldId: "",
  worlds: [],
  characters: [],
  pages: [],
  items: [],
  theme: defaultTheme,
  assets: [],
  set,
  init: async () => {
    try {
      await db.transaction("rw", [db.pages, db.items, db.themes], async () => {
        if (!(await db.pages.count())) {
          await db.pages.add({ id: "page-1", order: 0 });
          await db.items.bulkPut(defaultItems());
          await db.themes.put(defaultTheme);
        }
      });
      await get().reload();
      set({ ready: true });
    } catch {
      set({
        ready: true,
        pages: [{ id: "page-1", order: 0 }],
        items: defaultItems(),
        error:
          "浏览器存储不可用，当前更改可能无法保存。请检查隐私模式或存储空间。",
      });
    }
  },
  reload: async () => {
    const [worlds, characters, pages, items, theme, assets] = await Promise.all(
      [
        db.worlds.toArray(),
        db.characters.toArray(),
        db.pages.orderBy("order").toArray(),
        db.items.toArray(),
        db.themes.get("global"),
        db.assets.toArray(),
      ],
    );
    set({
      worlds,
      characters,
      pages,
      items,
      theme: theme || defaultTheme,
      assets,
    });
  },
  saveDesktop: async (items, pages = get().pages) => {
    try {
      await db.transaction("rw", [db.items, db.pages], async () => {
        await db.items.clear();
        await db.items.bulkPut(items);
        await db.pages.clear();
        await db.pages.bulkPut(pages);
      });
      set({ items, pages });
    } catch {
      set({ error: "桌面保存失败，请检查浏览器存储空间。" });
    }
  },
  saveTheme: async (theme) => {
    try {
      await db.themes.put(theme);
      set({ theme });
    } catch {
      set({ error: "主题保存失败，请检查浏览器存储空间。" });
    }
  },
}));
export async function safeWrite(action: () => Promise<unknown>) {
  try {
    await action();
    await usePhone.getState().reload();
    return true;
  } catch {
    usePhone
      .getState()
      .set({ error: "保存失败，请检查浏览器存储空间后重试。" });
    return false;
  }
}
export async function upload(file: File, type: Asset["type"]): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml")
    throw Error("请选择 JPG、PNG、WebP 等位图图片");
  if (file.size > 20 * 1024 * 1024) throw Error("图片不能超过 20 MB");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(
      1,
      (type === "wallpaper" ? 1600 : 400) / Math.max(img.width, img.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const id = crypto.randomUUID();
    await db.assets.put({
      id,
      type,
      data: canvas.toDataURL("image/webp", 0.82),
      createdAt: Date.now(),
    });
    await usePhone.getState().reload();
    return id;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function moveItem(
  items: DesktopItem[],
  id: string,
  pageId: string,
  targetId?: string,
) {
  const moving = items.find((i) => i.id === id);
  if (!moving) return items;
  const rest = items.filter((i) => i.id !== id);
  const dest = rest
    .filter((i) => i.pageId === pageId)
    .sort((a, b) => a.position - b.position);
  const index = targetId
    ? dest.findIndex((i) => i.id === targetId)
    : dest.length;
  dest.splice(index < 0 ? dest.length : index, 0, { ...moving, pageId });
  const order = new Map(dest.map((i, n) => [i.id, n]));
  return [
    ...rest.filter((i) => i.pageId !== pageId),
    ...dest.map((i) => ({ ...i, position: order.get(i.id)! })),
  ];
}

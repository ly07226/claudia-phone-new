import type {StoryReadingPreferences} from './storyReadingPreferences';
import type {ThemePalette,ThemeCSS} from './themePalette';
import {storySchemas,type StorySession,type StoryNode,type StoryPreferences} from './storyTypes';
import type {ScriptConfig} from './scriptTypes';
import { startupImportNotice } from "./importReceipt";
import type { DailyFriendship } from "./friendTypes";
import type { UserIdentity } from "./userIdentity";
import { installBackupGuard } from "./backupGate";
import type { Lorebook, LoreEntry } from "./loreTypes";
import Dexie, { type Table } from "dexie";
import { create } from "zustand";
import type { ApiConfig, ApiCredential } from "./api";
import type {
  MemoryTimeline, ConversationPathNode,
  Conversation,
  Message,
  WorldCharacterProfile,
  MessageVariant,
  MessageRevision,
  ConversationSnapshot,
} from "./chatTypes";
export interface World {
  /** Local document archive included in ZIP backups; raw source is never sent directly to story prompts. */
  storyDocument?: import('./wizardDocumentSnapshot').StoryDocumentSnapshot;
  simulatorSource?: {id:string;name:string;characters:number};
  script?: ScriptConfig;
  storyPreferences?: StoryPreferences;
  id: string;
  name: string;
  description: string;
  rules?: string;
  background?: string;
  createdAt: number;
}
export interface Character {
  dailyFriendship?: DailyFriendship;
  id: string;
  /** Legacy association retained for rollback; new links use worldProfiles. */
  worldId?: string;
  name: string;
  persona: string;
  speakingStyle?: string;
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
  /** One summary-only provider for every character and conversation. */
  dedicatedSummaryApi?: import('./dedicatedSummaryApi').DedicatedSummaryApi;
  chatHub?: import("./chatHubTypes").ChatHubData;
  storyReading?: StoryReadingPreferences;
  palette?: ThemePalette;
  customCss?: ThemeCSS;
  /** Scoped user metadata in the existing global configuration; not appearance inheritance. */
  userIdentities?: Record<string, UserIdentity>;
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
  type: "wallpaper" | "avatar" | "icon" | "chat-image";
  width?: number;
  height?: number;
  data: string;
  createdAt: number;
}
class PhoneDB extends Dexie {
  summaryLeases!: Table<import('./summaryLock').SummaryLease>;
  storySessions!: Table<StorySession>;
  storyNodes!: Table<StoryNode>;
  timelines!: Table<MemoryTimeline>;
  pathNodes!: Table<ConversationPathNode>;
  messageVariants!: Table<MessageVariant>;
  messageRevisions!: Table<MessageRevision>;
  conversationSnapshots!: Table<ConversationSnapshot>;
  lorebooks!: Table<Lorebook>;
  loreEntries!: Table<LoreEntry>;
  conversations!: Table<Conversation>;
  messages!: Table<Message>;
  worldProfiles!: Table<WorldCharacterProfile>;
  apiConfigs!: Table<ApiConfig>;
  apiCredentials!: Table<ApiCredential>;
  worlds!: Table<World>;
  characters!: Table<Character>;
  pages!: Table<DesktopPage>;
  items!: Table<DesktopItem>;
  themes!: Table<Theme>;
  assets!: Table<Asset>;
  constructor(databaseName = "claudia-phone") {
    super(databaseName);
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
    this.version(3)
      .stores({
        conversations: "id,&scopeKey,characterId,worldId,updatedAt",
        messages: "id,conversationId,[conversationId+createdAt]",
        worldProfiles: "id,&[worldId+characterId],worldId,characterId",
      })
      .upgrade(async (tx) => {
        const characters = await tx.table("characters").toArray();
        for (const c of characters)
          if (c.worldId && (await tx.table("worlds").get(c.worldId))) {
            await tx.table("worldProfiles").put({
              id: crypto.randomUUID(),
              worldId: c.worldId,
              characterId: c.id,
              setting: "",
            });
          }
      });
    // Additive v4: no legacy records are rewritten.
    this.version(4).stores({
      lorebooks: "id,updatedAt",
      loreEntries: "id,lorebookId",
    });
    this.version(5)
      .stores({
        messageVariants: "id,messageId,conversationId",
        messageRevisions: "id,messageId,conversationId,variantId",
        conversationSnapshots: "id,conversationId,createdAt",
      })
      .upgrade(async (tx) => {
        const messages = await tx.table("messages").toArray();
        for (const m of messages)
          if (m.role === "assistant" && !m.activeVariantId) {
            const id = crypto.randomUUID();
            await tx
              .table("messageVariants")
              .add({
                id,
                conversationId: m.conversationId,
                messageId: m.id,
                content: m.content,
                source: "legacy",
                createdAt: m.createdAt,
              });
            await tx.table("messages").update(m.id, { activeVariantId: id });
          }
      });
    // Additive v6: legacy rows and IDs are untouched; roots are initialized lazily.
    this.version(6).stores({timelines:"id,conversationId,parentTimelineId",pathNodes:"id,conversationId,[conversationId+parentNodeId+fingerprint]"});
    // Additive v7: existing records and IDs are retained.
    this.version(7).stores(storySchemas);
    // Additive v8: cross-window summary leases, existing records unchanged.
    this.version(8).stores({summaryLeases:'name,expiresAt'});

  }
}
export const db = new PhoneDB();
installBackupGuard(db);
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
  "记忆",
  "忍一下嘛",
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
  restoreNotice?: string;
  error: string;
  editing: boolean;
  activeApp: string | null;
  pageId: string;
  worldId: string;
  worlds: World[];
  characters: Character[];
  worldProfiles: WorldCharacterProfile[];
  pages: DesktopPage[];
  items: DesktopItem[];
  theme: Theme;
  assets: Asset[];
  set: (s: Partial<State>) => void;
  init: () => Promise<void>;
  saveDesktop: (items: DesktopItem[], pages?: DesktopPage[]) => Promise<void>;
  saveTheme: (theme: Pick<Theme,"id"> & Partial<Theme>) => Promise<void>;
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
  worldProfiles: [],
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
          if(!(await db.themes.get("global")))await db.themes.add(defaultTheme);
        }
      });
      await get().reload();
      const notice=await startupImportNotice(db,get());
      set({ ready: true,restoreNotice:notice });
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
    const [worlds, characters, pages, items, theme, assets, worldProfiles] =
      await Promise.all([
        db.worlds.toArray(),
        db.characters.toArray(),
        db.pages.orderBy("order").toArray(),
        db.items.toArray(),
        db.themes.get("global"),
        db.assets.toArray(),
        db.worldProfiles.toArray(),
      ]);
    set({
      worlds,
      characters,
      worldProfiles,
      pages,
      items: items.some(i=>i.kind==="app"&&i.app==="记忆")||!pages.length ? items : [...items,{id:"app-memory",kind:"app",app:"记忆",pageId:pages[0].id,position:Math.max(0,...items.filter(i=>i.pageId===pages[0].id).map(i=>i.position))+1,size:1}],
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
      const saved = await db.transaction("rw", db.themes, async () => {
        const current = await db.themes.get(theme.id);
        const saved:Theme = {...(current??defaultTheme),...theme, userIdentities: current?.userIdentities ?? theme.userIdentities, storyReading: current ? current.storyReading : theme.storyReading, chatHub: current ? current.chatHub : theme.chatHub};
        if(!saved.palette)delete saved.palette;
        if(!saved.customCss)delete saved.customCss;
        await db.themes.put(saved);
        return saved;
      });
      set({ theme: saved });
    } catch {
      set({ error: "主题保存失败，请检查浏览器存储空间。" });
    }
  },
}));
// No automatic reload: preserve unsaved UI input while asking other tabs to update.
db.on("blocked",()=>usePhone.getState().set({error:"数据库升级被其他窗口阻挡，请关闭其他标签页和 PWA 后重试；不会清理数据。"}));
db.on("versionchange",()=>{db.close();usePhone.getState().set({error:"本地数据库已由其他窗口更新，请保存当前输入后刷新页面。"});});
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

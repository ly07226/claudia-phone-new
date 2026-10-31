import { create } from "zustand";
import { db, usePhone } from "./store";
export const spaceStorageKey = "claudia.navigation.v1";
export type SpaceId = "daily" | `world:${string}`;
export type SpaceIdentity =
  | { spaceId: "daily"; type: "daily"; worldId?: undefined }
  | { spaceId: `world:${string}`; type: "world"; worldId: string };
export type SpaceRoute =
  { screen: "spaces" } | {screen: "worlds"; view?: "create" | "manual" | "edit"; worldId?: string} | { screen: "phone"; spaceId: SpaceId };
const list: SpaceRoute = { screen: "spaces" };
let sequence = 0;
function identity(id: SpaceId): SpaceIdentity {
  return id === "daily"
    ? { spaceId: "daily", type: "daily" }
    : { spaceId: id, type: "world", worldId: id.slice(6) };
}
function hash(route: SpaceRoute) {
  return route.screen === "phone"
    ? route.spaceId === "daily"
      ? "#phone/daily"
      : `#phone/world/${encodeURIComponent(route.spaceId.slice(6))}`
    : route.screen === "worlds" && route.view
      ? route.view === "edit" ? `#worlds/edit/${encodeURIComponent(route.worldId || "")}` : `#worlds/create${route.view === "manual" ? "/manual" : ""}`
      : `#${route.screen}`;
}
function fromHash(): SpaceRoute | null {
  const value = location.hash;
  if (!value) return null;
  if (value === "#spaces" || value === "#worlds")
    return { screen: value.slice(1) as "spaces" | "worlds" };
  if (value === "#worlds/create") return {screen:"worlds",view:"create"};
  if (value === "#worlds/create/manual") return {screen:"worlds",view:"manual"};
  if (value.startsWith("#worlds/edit/")) {
    try { const worldId = decodeURIComponent(value.slice(13)); if(worldId && worldId.length <= 2000) return {screen:"worlds",view:"edit",worldId}; } catch { /* Invalid route falls back safely. */ }
    return {screen:"worlds"};
  }
  if (value === "#phone/daily") return { screen: "phone", spaceId: "daily" };
  if (value.startsWith("#phone/world/")) {
    try {
      const id = decodeURIComponent(value.slice(13));
      if (id && id.length <= 2000)
        return { screen: "phone", spaceId: `world:${id}` };
    } catch {
      /* Invalid navigation is handled as a list route, never as another world. */
    }
  }
  return list;
}
function savedRoute(): SpaceRoute {
  try {
    const saved = JSON.parse(localStorage.getItem(spaceStorageKey) || "null");
    if (saved?.version !== 1) return list;
    const r = saved.route;
    if (r?.screen === "spaces") return {screen:"spaces"};
    if (r?.screen === "worlds") {
      if (r.view === "create" || r.view === "manual") return {screen:"worlds",view:r.view};
      if (r.view === "edit" && typeof r.worldId === "string" && r.worldId.length > 0 && r.worldId.length <= 2000) return {screen:"worlds",view:"edit",worldId:r.worldId};
      return {screen:"worlds"};
    }
    if (
      r?.screen === "phone" &&
      (r.spaceId === "daily" ||
        (typeof r.spaceId === "string" &&
          r.spaceId.startsWith("world:") &&
          r.spaceId.length > 6 &&
          r.spaceId.length <= 2006))
    )
      return { screen: "phone", spaceId: r.spaceId };
  } catch {
    /* Storage or malformed JSON cannot prevent access to the permanent daily space. */
  }
  return list;
}
interface SpaceState {
  booted: boolean;
  transitioning: boolean;
  route: SpaceRoute;
  space: SpaceIdentity | null;
  notice: string;
  restoreCurrentSpace: () => Promise<void>;
  enterSpace: (id: SpaceId) => Promise<void>;
  exitSpace: () => Promise<void>;
  manageWorlds: (replace?: boolean) => Promise<void>;
  openWorldEditor: (view: "create" | "manual" | "edit", worldId?: string) => Promise<void>;
  restoreUrl: () => Promise<void>;
  reconcile: () => Promise<void>;
}
export const useSpaces = create<SpaceState>((set, get) => {
  const navigate = async (
    requested: SpaceRoute,
    mode: "push" | "replace" | "pop",
  ) => {
    const previous = { route: get().route, space: get().space };
    const previousNotice = get().notice;
    const ticket = ++sequence;
    // Synchronously unmount Chat before validating the destination. This aborts
    // its request and keeps the existing generation token/late-response guards.
    set({ transitioning: true });
    usePhone.getState().set({ activeApp: null, editing: false });
    let route = requested;
    let notice = "";
    if (route.screen === "phone" && route.spaceId !== "daily") {
      try {
        if (!(await db.worlds.get(identity(route.spaceId).worldId!))) {
          route = list;
          notice = "该世界已不存在，已返回空间列表；其他空间数据未改变。";
        }
      } catch {
        route = list;
        notice = "无法确认世界是否存在，请检查浏览器存储后重试。";
      }
    }
    if (ticket !== sequence) return;
    const space = route.screen === "phone" ? identity(route.spaceId) : null;
    usePhone
      .getState()
      .set({ activeApp: null, editing: false, worldId: space?.worldId || "" });
    try {
      if (hash(route) !== location.hash) {
        if (mode === "push")
          history.pushState({ claudiaSpace: true }, "", hash(route));
        else history.replaceState({ claudiaSpace: true }, "", hash(route));
      }
    } catch {
      notice = "浏览器导航不可用，未切换空间。请刷新后重试。";
      usePhone
        .getState()
        .set({ worldId: previous.space?.worldId || "", error: notice });
      set({ ...previous, notice, booted: true, transitioning: false });
      return;
    }
    try {
      localStorage.setItem(
        spaceStorageKey,
        JSON.stringify({ version: 1, route }),
      );
      if (previousNotice && usePhone.getState().error === previousNotice)
        usePhone.getState().set({ error: "" });
    } catch {
      notice =
        "空间导航无法保存，刷新后可能需要重新选择；聊天数据仍由本地数据库保存。";
      usePhone.getState().set({ error: notice });
    }
    set({ route, space, notice, booted: true, transitioning: false });
  };
  return {
    booted: false,
    transitioning: false,
    route: list,
    space: null,
    notice: "",
    restoreCurrentSpace: () => navigate(fromHash() || savedRoute(), "replace"),
    enterSpace: (spaceId) => navigate({ screen: "phone", spaceId }, "push"),
    exitSpace: () => {
      const r = get().route;
      return navigate(get().space?.type === "world" || (r.screen === "worlds" && r.view)
        ? r.screen === "worlds" && r.view === "manual" ? {screen:"worlds",view:"create"} : {screen:"worlds"}
        : list, "push");
    },
    manageWorlds: (replace = false) => navigate({ screen: "worlds" }, replace ? "replace" : "push"),
    openWorldEditor: (view, worldId) => navigate({screen:"worlds",view,...(view === "edit" ? {worldId} : {})}, "push"),
    restoreUrl: async () => {
      const route = fromHash() || list;
      if (
        !get().transitioning &&
        JSON.stringify(route) === JSON.stringify(get().route)
      )
        return;
      await navigate(route, "pop");
    },
    reconcile: async () => {
      const s = get();
      if (
        s.booted &&
        !s.transitioning &&
        s.space?.type === "world" &&
        !usePhone.getState().worlds.some((w) => w.id === s.space!.worldId)
      )
        await navigate(list, "replace");
    },
  };
});

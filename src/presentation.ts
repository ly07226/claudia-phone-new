import { useEffect, useLayoutEffect, useState } from "react";
import type { Theme, Asset } from "./store";

export function displayEnvironment() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return { ios, standalone: !!(navigator as Navigator & {standalone?:boolean}).standalone || matchMedia("(display-mode: standalone)").matches };
}
export function useDisplayEnvironment() {
  const [environment, setEnvironment] = useState(displayEnvironment);
  useEffect(() => {
    const media = matchMedia("(display-mode: standalone)");
    const update = () => setEnvironment(displayEnvironment());
    if (media.addEventListener) media.addEventListener("change", update);
    else media.addListener(update);
    window.addEventListener("pageshow", update);
    return () => {if(media.removeEventListener) media.removeEventListener("change",update);else media.removeListener(update);window.removeEventListener("pageshow",update);};
  }, []);
  return environment;
}
export const spaceBackground = "radial-gradient(ellipse at top left, #dce9d4, transparent 65%), #f4f5eb";
export const defaultWallpaperOverlay = "radial-gradient(ellipse at 95% 72%, #edf1db9c, transparent 60%), linear-gradient(145deg, #d8e0d290, #9eafa37a)";
/** Visual state only: never persists theme, wallpaper, or navigation data. */
export function usePageCanvas(phone: boolean, activeApp: string | null, theme: Theme, assets: Asset[]) {
  const environment = useDisplayEnvironment();
  const wallpaper = phone && (!activeApp || activeApp === "主题编辑器") ? assets.find(a=>a.id===theme.wallpaper)?.data : undefined;
  useLayoutEffect(() => {
    const root = document.documentElement;
    const desktop = phone && (!activeApp || activeApp === "主题编辑器");
    const color = desktop ? theme.color : phone ? "#f3f5ec" : "#f4f5eb";
    root.dataset.ios = String(environment.ios);
    root.dataset.standalone = String(environment.standalone);
    root.dataset.screen = desktop ? activeApp ? "preview" : "desktop" : phone ? "app" : "spaces";
    root.style.setProperty("--page-background", desktop ? wallpaper ? `url(${JSON.stringify(wallpaper)}) ${color}` : `${defaultWallpaperOverlay}, ${color}` : phone ? color : spaceBackground);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if(meta) meta.content = color;
    return () => {
      root.style.removeProperty("--page-background");
      delete root.dataset.ios; delete root.dataset.standalone; delete root.dataset.screen;
      if(meta) meta.content = "#c5d1c3";
    };
  }, [phone, activeApp, theme.color, wallpaper, environment.ios, environment.standalone]);
}

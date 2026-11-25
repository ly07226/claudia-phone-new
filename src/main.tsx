import {installPrivateNotesScheduler} from './privateNotesScheduler';
import {installCharacterLifeScheduler} from './characterLifeScheduler';
import {PrivateNotes} from './PrivateNotes';
import {ChatBannerSettings} from './ChatBannerSettings';
import {WechatIntegrationSettings} from './WechatIntegrationSettings';
import {reconcileWechatAfterReopen} from './wechatClosedContinuity';
import {reconcileQqAfterReopen} from './qqClosedContinuity';
import {GlobalChatNotifications} from './GlobalChatNotifications';
import {installMemorySummaryScheduler} from './memorySummaryScheduler';
import {PhasePlayApp} from './phasePlay/PhasePlayApp';
import {ChatHubScheduler} from './ChatHubScheduler';
import {ProactiveScheduler} from './ProactiveScheduler';
import {MemoryCalendarScheduler} from './MemoryCalendarScheduler';
import {BackgroundReplyReconciler} from './BackgroundReplyReconciler';
import {AudioKeepAliveSettings,initializeAudioKeepAlive} from './AudioKeepAliveSettings';
import {PushNotificationSettings} from './PushNotificationSettings';
import {ThemeEditor} from './ThemeEditor';
import {openPhoneApp,editPhoneDesktop,backPhonePage,usePhonePageNavigation} from './phonePageNavigation';
import {useEffectiveTheme,themeSafeMode} from './themeAppearance';
import {StoryApp} from './StoryApp';
import { MemoryApp } from "./MemoryApp";
import { IdentityCard, IdentityEditor } from "./IdentitySettings";
import { useDisplayEnvironment } from "./presentation";
import { Lorebooks } from "./Lorebooks";
import { Chat } from "./Chat";
import { CharacterManager } from "./CharacterManager";
import { Worlds } from "./Worlds";
import { SpaceRoot } from "./SpaceSelection";
import { useSpaces } from "./spaces";
import { ApiSettings } from "./ApiSettings";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  Brain,
  MessageCircle,
  Menu,
  NotebookPen,
  Music2,
  CalendarDays,
  ScanFace,
  ShoppingBag,
  BookOpen,
  Flower2,
  Settings,
  Palette,
  Globe2,
  Users,
  ChevronLeft,
  Plus,
  X,
  Check,
  Wifi,
  BatteryFull,
  Signal,
  ArrowRight,
  ImagePlus,
  Grip,
  Trash2,
} from "lucide-react";
import {
  usePhone,
  apps,
  db,
  safeWrite,
  upload,
  defaultItems,
  defaultTheme,
  moveItem,
  type DesktopItem,
} from "./store";
import "./style.css";
import "./themeGlobal.css";
import "./iosStandaloneViewportExperiment.css";
const icons = [
  MessageCircle,
  NotebookPen,
  Music2,
  CalendarDays,
  ScanFace,
  ShoppingBag,
  BookOpen,
  Flower2,
  Settings,
  Palette,
  Globe2,
  Users,
  Brain,
];
function App() {
  const environment = useDisplayEnvironment();
  const s = usePhone();
  useEffect(()=>{if(!s.ready)return;const stopLife=installCharacterLifeScheduler(),stopNotes=installPrivateNotesScheduler();return()=>{stopLife();stopNotes()}},[s.ready]);
  // Opt-in WeChat recovery only: no project configuration means no cloud request.
  // iOS cannot run this while the PWA is closed; reconcile on reopen/foreground.
  useEffect(() => {
    if (!s.ready) return;
    const reconcile = () => {
      if (document.visibilityState === 'visible') {
        void reconcileQqAfterReopen().catch(error =>
          console.warn('QQ 离线同步将在下次打开时重试：',error instanceof Error?error.message:'unknown')
        );
        void reconcileWechatAfterReopen().catch(error =>
          console.warn('微信离线同步将在下次打开时重试：', error instanceof Error ? error.message : 'unknown')
        );
      }
    };
    reconcile();
    // Keep opted-in WeChat conversations current while the app stays open.
    // The reconciler coalesces overlapping requests and checks opt-in itself.
    const interval = window.setInterval(reconcile, 8000);
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('pageshow', reconcile);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('pageshow', reconcile);
    };
  }, [s.ready]);
  // iOS standalone first-paint experiment: emulate the smallest possible scroll
  // transaction on the existing scrollable element. Restore its position before
  // paint, and never touch focused inputs or the document scroll position.
  useEffect(() => {
    if (!environment.ios || !environment.standalone || !s.ready) return;
    let frame = 0, second = 0, third = 0;
    const settle = () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(second); cancelAnimationFrame(third);
      frame = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          const phone = document.querySelector<HTMLElement>('.stage > .phone');
          if (!phone || document.activeElement?.matches('input,textarea,select')) return;
          const scrollable = [phone.querySelector<HTMLElement>('[role=tabpanel]:not([hidden])'),phone.querySelector<HTMLElement>('.app-scroll'),phone.querySelector<HTMLElement>('.desktop')]
            .find(el => el && el.scrollHeight > el.clientHeight + 2);
          if (!scrollable) return;
          const original = scrollable.scrollTop;
          const next = original > 0 ? original - 1 : original + 1;
          scrollable.scrollTop = next;
          third = requestAnimationFrame(() => { if (scrollable.isConnected) scrollable.scrollTop = original; });
        });
      });
    };
    settle();
    window.addEventListener('pageshow', settle);
    document.addEventListener('visibilitychange', settle);
    return () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(second); cancelAnimationFrame(third);
      window.removeEventListener('pageshow', settle);
      document.removeEventListener('visibilitychange', settle);
    };
  }, [environment.ios, environment.standalone, s.ready, s.activeApp]);

  const phoneNavigation=usePhonePageNavigation();
  const appearance = useEffectiveTheme(s.theme);
  useEffect(()=>{if(s.ready&&themeSafeMode())s.set({activeApp:"主题编辑器"});},[s.ready]);
  const space = useSpaces((state) => state.space);
  const [now, setNow] = useState(new Date());
  const [drag, setDrag] = useState<string | null>(null);
  const [dragOffset,setDragOffset] = useState({x:0,y:0});
  const [hoverPage,setHoverPage] = useState<string|null>(null);
  const [dragPoint,setDragPoint] = useState<{x:number;y:number}|null>(null);
  const [dragAnchor,setDragAnchor] = useState({x:0,y:0});
  const edgeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const edgeTarget=useRef<string|null>(null);
  const dragPage=useRef<string|null>(null);
  const clearEdge=()=>{if(edgeTimer.current)clearTimeout(edgeTimer.current);edgeTimer.current=null;edgeTarget.current=null;};
  const [busy, setBusy] = useState(false);
  const gesture = useRef<
    | {
        x: number;
        y: number;
        timer?: ReturnType<typeof setTimeout>;
        id: string;
        drag: boolean;
        cancelled: boolean;
        pointerId: number;
        origin: HTMLElement;
      }
    | undefined
  >(undefined);
  const suppress = useRef(false);
  const swipe = useRef<{x:number;y:number;time:number}|null>(null);
  const [swipeDirection,setSwipeDirection] = useState<"left"|"right">("left");
  useEffect(() => {
    // The desktop clock is not visible inside apps. Avoid a full root render
    // every second while the user types or navigates a long conversation.
    if (s.activeApp) return;
    setNow(new Date());
    const t = setInterval(() => {
      if (!document.hidden) setNow(new Date());
    }, 1000);
    return () => clearInterval(t);
  }, [s.activeApp]);
  useEffect(() => () => {
    clearTimeout(gesture.current?.timer);
    gesture.current = undefined;
  }, []);
  const wallpaperSurface = !s.activeApp || s.activeApp === "主题编辑器";
  const asset = (id?: string) => s.assets.find((a) => a.id === id)?.data;
  async function fileChange(
    file: File | undefined,
    type: "wallpaper" | "icon" | "avatar",
    done: (id: string) => Promise<unknown>,
  ) {
    if (!file) return;
    setBusy(true);
    try {
      await done(await upload(file, type));
    } catch (e) {
      s.set({ error: e instanceof Error ? e.message : "图片处理失败" });
    } finally {
      setBusy(false);
    }
  }
  function start(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    suppress.current = false;
    const g = {
      x: e.clientX,
      y: e.clientY,
      id,
      drag: s.editing,
      cancelled: false,
      pointerId: e.pointerId,
      origin: e.currentTarget as HTMLElement,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    gesture.current = g;
    const icon=e.currentTarget.querySelector<HTMLElement>(".app-icon") || e.currentTarget as HTMLElement;
    const bounds=icon.getBoundingClientRect();
    setDragAnchor({x:e.clientX-bounds.left,y:e.clientY-bounds.top});
    setDragOffset({x:0,y:0});
    setDragPoint(null);
    dragPage.current=s.pageId;
    clearEdge();
    setHoverPage(null);
    if (s.editing) {
      (e.currentTarget.closest(".desktop") as HTMLElement)?.setPointerCapture(e.pointerId);
      setDrag(id);
      setDragPoint({x:e.clientX,y:e.clientY});
    } else
      g.timer = setTimeout(() => {
        if(g.cancelled)return;
        g.drag = true;
        try{(g.origin.closest(".desktop") as HTMLElement)?.setPointerCapture(g.pointerId);}catch{/* pointer may already have ended */}
        suppress.current = true;
        editPhoneDesktop();
        setDrag(id);
        setDragPoint({x:g.x,y:g.y});
        navigator.vibrate?.(20);
      }, 550);
  }
  function motion(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (!g.drag && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) {
      clearTimeout(g.timer);
      g.cancelled = true;
      suppress.current = true;
    }
    if (g.drag) {
      e.preventDefault();
      setDrag(g.id);
      setDragOffset({x:e.clientX-g.x,y:e.clientY-g.y});
      setDragPoint({x:e.clientX,y:e.clientY});
      const desktop=document.querySelector<HTMLElement>(".desktop");
      const rect=desktop?.getBoundingClientRect();
      const edge=rect && e.clientX<rect.left+44 ? -1 : rect && e.clientX>rect.right-44 ? 1 : 0;
      const current=usePhone.getState();
      const index=current.pages.findIndex(p=>p.id===current.pageId);
      const next=edge ? current.pages[index+edge] : undefined;
      if(next){
        if(edgeTarget.current!==next.id){
          clearEdge();
          edgeTarget.current=next.id;
          edgeTimer.current=setTimeout(()=>{
            const state=usePhone.getState();
            const target=state.pages.find(p=>p.id===next.id);
            if(target && gesture.current?.drag){
              setSwipeDirection(edge===1?"left":"right");
              state.set({pageId:target.id});
              dragPage.current=target.id;
              setHoverPage(target.id);
            }
            clearEdge();
          },480);
        }
      }else clearEdge();
      const hit=document.elementFromPoint(e.clientX,e.clientY);
      setHoverPage(hit?.closest<HTMLElement>("[data-page]")?.dataset.page??null);
    }
  }
  function end(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    clearTimeout(g.timer);
    clearEdge();
    if (g.drag) {
      suppress.current = true;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const page = el?.closest<HTMLElement>("[data-page]")?.dataset.page;
      const target = el?.closest<HTMLElement>("[data-item]")?.dataset.item;
      const virtual = g.id === 'virtual-phase-play-app' || g.id === 'virtual-story-app';
      const dragged = virtual ? displayItems.find(i=>i.id===g.id) : undefined;
      const items = dragged ? [...s.items, {...dragged}] : s.items;
      const destination = page || dragPage.current || s.pageId;
      if (page) {
        void s.saveDesktop(moveItem(items, g.id, page));
        s.set({ pageId: page });
      } else if (target && target !== g.id)
        void s.saveDesktop(moveItem(items, g.id, destination, target));
      else if(dragged || (dragPage.current && dragPage.current!==s.items.find(i=>i.id===g.id)?.pageId))
        void s.saveDesktop(moveItem(items,g.id,destination));
    }
    setDrag(null);
    setDragPoint(null);
    dragPage.current=null;
    setHoverPage(null);
    setDragOffset({x:0,y:0});
    gesture.current = undefined;
  }
  // Migrate only overflowing desktop pages, preserving icon order and all item IDs.
  // A page has three rows of four icon slots; widgets occupy their declared column span.
  useEffect(() => {
    if(!s.ready || s.editing || !s.pages.length) return;
    const capacity=12;
    const ordered=[...s.items].sort((a,b)=>a.position-b.position);
    const overflowing=s.pages.some(page=>ordered.filter(item=>item.pageId===page.id).reduce((n,item)=>n+(item.kind==="widget"?item.size:1),0)>capacity);
    if(!overflowing)return;
    const pages=[...s.pages],items=ordered.map(item=>({...item}));
    for(const page of s.pages){
      const entries=items.filter(item=>item.pageId===page.id);
      let used=0,overflowPage:string|undefined,overflowUsed=0;
      for(const item of entries){
        const slots=item.kind==="widget"?item.size:1;
        if(!overflowPage && used+slots<=capacity){used+=slots;continue;}
        if(!overflowPage || overflowUsed+slots>capacity){
          overflowPage=crypto.randomUUID();overflowUsed=0;
          pages.push({id:overflowPage,order:pages.length});
        }
        item.pageId=overflowPage;item.position=overflowUsed;overflowUsed+=slots;
      }
    }
    void s.saveDesktop(items,pages);
  },[s.ready,s.editing,s.items,s.pages]);
  // Persist the bundled app on every existing desktop. A virtual icon appended to a full
  // first page can be clipped; choose a page with space or create a new reachable page.
  useEffect(() => {
    if(!s.ready || s.editing || !s.pages.length || s.items.some(i=>i.kind==='app'&&i.app==='忍一下嘛'))return;
    const capacity=12;
    const page=s.pages.find(p=>s.items.filter(i=>i.pageId===p.id).reduce((n,i)=>n+(i.kind==='widget'?i.size:1),0)<capacity);
    const target=page??{id:crypto.randomUUID(),order:s.pages.length};
    const pages=page?s.pages:[...s.pages,target];
    const position=Math.max(0,...s.items.filter(i=>i.pageId===target.id).map(i=>i.position))+1;
    void s.saveDesktop([...s.items,{id:crypto.randomUUID(),kind:'app',app:'忍一下嘛',pageId:target.id,position,size:1}],pages);
  },[s.ready,s.editing,s.items,s.pages]);
  const pageIndex = s.pages.findIndex((p) => p.id === s.pageId);
  const canStory=!!space?.worldId&&s.worlds.find(w=>w.id===space.worldId)?.script?.playMode==='story';
  const firstPage=s.pages[0]?.id;
  const displayItems=s.items.filter(i=>i.app!=='剧本'||canStory);
  if(canStory&&!displayItems.some(i=>i.app==='剧本')&&firstPage)displayItems.push({id:'virtual-story-app',kind:'app',app:'剧本',pageId:firstPage,position:Math.max(0,...displayItems.filter(i=>i.pageId===firstPage).map(i=>i.position))+1,size:1});
  // Existing users retain their customized desktop; expose the new app without resetting their layout.
  if(!displayItems.some(i=>i.kind==='app'&&i.app==='忍一下嘛')&&firstPage)displayItems.push({id:'virtual-phase-play-app',kind:'app',app:'忍一下嘛',pageId:firstPage,position:Math.max(0,...displayItems.filter(i=>i.pageId===firstPage).map(i=>i.position))+1,size:1});
  const pageItems = displayItems
    .filter((i) => i.pageId === s.pageId)
    .sort((a, b) => a.position - b.position);
  function widget(item: DesktopItem) {
    return (
      <div className="widget-content">
        {item.widget === "quote" ? (
          <>
            <span className="eyebrow">A LITTLE MOMENT</span>
            <p>
              把日子过成
              <br />
              <em>自己喜欢的模样。</em>
            </p>
            <span className="widget-foot">
              <span>慢慢来，也很好</span>
              <Flower2 size={27} />
            </span>
          </>
        ) : item.widget === "calendar" ? (
          <>
            <span className="eyebrow">TODAY / 今日</span>
            <p>
              {now.getDate()}{" "}
              <small>
                {now.toLocaleDateString("zh-CN", { weekday: "long" })}
              </small>
            </p>
            <span>留一点时间给自己。</span>
          </>
        ) : (
          <>
            <span className="eyebrow">NOTE TO SELF</span>
            <p>
              记得呼吸，
              <br />
              记得感受当下。
            </p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="stage" data-ios={environment.ios || undefined} data-standalone={environment.standalone || undefined}>
      <ChatHubScheduler/>
      <MemoryCalendarScheduler/><ProactiveScheduler/>
      <aside className="brand">
        <span className="brand-mark">c.</span>
        <h1>
          Claudia
          <br />
          Phone<span>你的世界，随身携带。</span>
        </h1>
        <p>A quiet place for your stories.</p>
        <div className="brand-line" />
        <span className="eyebrow">PERSONAL SPACE · PHASE 01</span>
      </aside>
      <main
        className={`phone ${s.editing ? "editing" : ""}`}
        data-theme-editing={String(s.activeApp === "主题编辑器")}
        data-inner-app={String(!!s.activeApp)}
        style={
          {
            "--accent": appearance.color,
            "--glass": appearance.opacity,
            "--blur": `${appearance.blur}px`,
            fontFamily:
              appearance.font === "serif"
                ? 'Georgia, "Songti SC", serif'
                : undefined,
            backgroundColor: wallpaperSurface ? appearance.color : appearance.palette?.colors.page ?? "#f3f5ec",
            backgroundImage: wallpaperSurface && asset(appearance.wallpaper)
              ? `url(${asset(appearance.wallpaper)})`
              : undefined,
          } as React.CSSProperties
        }
      >
        <div
          className="wallpaper-art"
          style={{ display: !wallpaperSurface || asset(appearance.wallpaper) || appearance.palette ? "none" : undefined }}
        />
        <div className="status" aria-label={environment.ios ? "空间导航" : "模拟手机状态栏"}>
          {!environment.ios && <span className="simulated-time">
            {now.toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>}
          {!s.activeApp && <button
            className="space-return"
            aria-label="返回空间列表"
            onClick={() => void useSpaces.getState().exitSpace()}
          >
            <ChevronLeft size={12} />
            <span>
              {space?.type === "world"
                ? s.worlds.find((w) => w.id === space.worldId)?.name
                : "日常手机"}{" "}
              · {space?.type === "world" ? "剧本列表" : "空间列表"}
            </span>
          </button>}
          {!environment.ios && <span className="status-icons">
            <Signal size={14} />
            <Wifi size={15} />
            <BatteryFull size={20} />
          </span>}
        </div>
        {!s.ready ? (
          <div className="loading">正在整理你的小小世界…</div>
        ) : s.activeApp ? (
          <section className={`app-panel${s.activeApp==='剧本'?' story-panel':''}`} key={s.activeApp}>
            <header>
              <button
                aria-label={`返回${phoneNavigation.parentName}`}
                onClick={phoneNavigation.back}
              >
                <ChevronLeft />
                {phoneNavigation.parentName}
              </button>
              <span>{s.activeApp === "手记" ? "私人记录" : s.activeApp}</span>
              {s.activeApp === "手记" ? <button type="button" aria-label="私人记录设置" onClick={() => window.dispatchEvent(new Event("private-notes-open-settings"))}><Menu size={20}/></button> : <Flower2 size={20} />}
            </header>
            <div className={`app-scroll${s.activeApp==='剧本'?' story-scroll':''}`}>
              {s.activeApp === "设置" ? (
                <>
                  <div className="page-title">
                    <span className="eyebrow">MAKE IT YOURS</span>
                    <h2>设置</h2>
                    <p>让这里，成为你的舒适区。</p>
                  </div>
                  <IdentityCard spaceId={space?.spaceId || "daily"}/>
                  <AudioKeepAliveSettings/>
                  <PushNotificationSettings/><ChatBannerSettings/>
                  <button
                    className="list-row"
                    onClick={() => openPhoneApp("数据备份与恢复")}
                  >
                    <NotebookPen />
                    数据备份与恢复
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="list-row"
                    onClick={() => openPhoneApp("世界书 / Lorebook")}
                  >
                    <BookOpen />
                    世界书 / Lorebook
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="list-row"
                    onClick={() => openPhoneApp("AI / API 设置")}
                  >
                    <Settings />
                    AI / API 设置
                    <ArrowRight size={17} />
                  </button>
                  <button className="list-row" onClick={() => openPhoneApp("微信接入")}>
                    <MessageCircle />
                    微信接入
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="list-row"
                    onClick={() => openPhoneApp("主题编辑器")}
                  >
                    <Palette />
                    主题与桌面
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="list-row"
                    onClick={editPhoneDesktop}
                  >
                    <Grip />
                    编辑桌面
                    <ArrowRight size={17} />
                  </button>
                  <div className="card">
                    <h3>本地存储</h3>
                    <p>
                      {s.worlds.length} 个世界 · {s.characters.length} 位角色 ·{" "}
                      {s.assets.length} 张图片
                    </p>
                    <p>
                      清除网站数据会删除本地内容，请保留重要人设备份。iPhone
                      请通过 HTTPS 网站或「添加到主屏幕」运行。
                    </p>
                  </div>
                  <button
                    className="danger list-row"
                    onClick={() => {
                      if (confirm("恢复默认桌面和主题？世界和角色会保留。"))
                        void s
                          .saveDesktop(defaultItems(), [
                            { id: "page-1", order: 0 },
                          ])
                          .then(() => {
                            s.set({ pageId: "page-1" });
                            return s.saveTheme({...defaultTheme,palette:undefined,customCss:undefined});
                          });
                    }}
                  >
                    恢复默认桌面布局与主题
                  </button>
                </>
              ) : s.activeApp === "用户身份" ? (
                <IdentityEditor key={space?.spaceId || "daily"} spaceId={space?.spaceId || "daily"}/>
              ) : s.activeApp === "聊天" || s.activeApp === "世界聊天" ? (
                <Chat worldId={space?.worldId} />
              ) : s.activeApp === "忍一下嘛" ? (
                <PhasePlayApp onBack={phoneNavigation.back}/>
              ) : s.activeApp === "世界书 / Lorebook" ? (
                <Lorebooks />
              ) : s.activeApp === "微信接入" ? (
                <WechatIntegrationSettings />
              ) : s.activeApp === "AI / API 设置" ? (
                <ApiSettings />
              ) : s.activeApp === "主题编辑器" ? (
                <>
                  <ThemeEditor theme={s.theme}/>
                  <section className="theme-personalization"><h3>其他个性化设置</h3><p>以下字体、玻璃效果、壁纸和图标沿用独立即时保存，不受上方配色与 CSS 的取消操作影响。</p>
                  <div className="card form">
                    <label>
                      玻璃透明度{" "}
                      <output>{Math.round(s.theme.opacity * 100)}%</output>
                      <input
                        aria-label="玻璃透明度"
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.01"
                        value={s.theme.opacity}
                        onChange={(e) =>
                          void s.saveTheme({
                            id:s.theme.id,
                            opacity: +e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      背景模糊 <output>{s.theme.blur}px</output>
                      <input
                        aria-label="背景模糊"
                        type="range"
                        min="0"
                        max="40"
                        value={s.theme.blur}
                        onChange={(e) =>
                          void s.saveTheme({
                            id:s.theme.id,
                            blur: +e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      字体
                      <select
                        value={s.theme.font}
                        onChange={(e) =>
                          void s.saveTheme({ id:s.theme.id, font: e.target.value })
                        }
                      >
                        <option value="sans">清晰无衬线</option>
                        <option value="serif">文艺衬线</option>
                      </select>
                    </label>
                    <label>
                      图标形状
                      <select
                        value={s.theme.iconStyle}
                        onChange={(e) =>
                          void s.saveTheme({
                            id:s.theme.id,
                            iconStyle: e.target.value as "rounded" | "squircle",
                          })
                        }
                      >
                        <option value="rounded">柔和圆角</option>
                        <option value="squircle">圆形</option>
                      </select>
                    </label>
                  </div>
                  <label className="list-row upload">
                    <ImagePlus />
                    上传桌面壁纸
                    <input
                      aria-label="上传桌面壁纸"
                      type="file"
                      accept="image/*"
                      disabled={busy}
                      onChange={(e) =>
                        void fileChange(
                          e.target.files?.[0],
                          "wallpaper",
                          (id) => s.saveTheme({ id:s.theme.id, wallpaper: id }),
                        )
                      }
                    />
                  </label>
                  {s.theme.wallpaper && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void s.saveTheme({ id:s.theme.id, wallpaper: undefined })
                      }
                    >
                      使用默认壁纸
                    </button>
                  )}
                  <div className="card">
                    <h3>自定义应用图标</h3>
                    {apps.map((app) => (
                      <label className="icon-upload" key={app}>
                        {app}
                        <span>更换图片 +</span>
                        <input
                          aria-label={`上传${app}图标`}
                          type="file"
                          accept="image/*"
                          disabled={busy}
                          onChange={(e) =>
                            void fileChange(e.target.files?.[0], "icon", (id) =>
                              s.saveDesktop(
                                s.items.map((i) =>
                                  i.app === app ? { ...i, icon: id } : i,
                                ),
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p className="hint">
                    图片上限 20
                    MB，上传后自动压缩。世界独立主题接口已预留，当前使用全局主题。
                  </p>
                  </section>
                </>
              ) : s.activeApp === "世界管理" ? (
                <Worlds />
              ) : s.activeApp === "剧本" ? (
                canStory&&space?.worldId?<StoryApp key={space.worldId} worldId={space.worldId}/>:<p>当前空间没有剧情模式主线入口。</p>
              ) : s.activeApp === "手记" ? (
                <PrivateNotes />
              ) : s.activeApp === "记忆" ? (
                <MemoryApp />
              ) : s.activeApp === "角色管理" ? (
                <CharacterManager fileChange={fileChange} />
              ) : (
                <div className="placeholder">
                  <div className="placeholder-icon">
                    {React.createElement(
                      icons[apps.indexOf(s.activeApp)] || Flower2,
                      { size: 40 },
                    )}
                  </div>
                  <span className="eyebrow">COMING IN A LATER CHAPTER</span>
                  <h2>{s.activeApp}</h2>
                  <p>这个小世界，还在慢慢生长。</p>
                  <div className="card">
                    第一阶段占位页面
                    <br />
                    尚未实现该应用，也未连接 AI 服务。
                  </div>
                  <button
                    className="primary"
                    onClick={() => s.set({ activeApp: "角色管理" })}
                  >
                    先认识你的角色 <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section
            className="desktop"
            onPointerMove={motion}
            onPointerUp={end}
            onPointerCancel={() => {
              clearTimeout(gesture.current?.timer);
              clearEdge();
              gesture.current=undefined;
              setDrag(null);
              setDragPoint(null);
              dragPage.current=null;
              setHoverPage(null);
            }}
            onTouchStart={(e) => {
              if (!gesture.current?.drag && e.touches.length === 1)
                swipe.current = {x:e.touches[0].clientX,y:e.touches[0].clientY,time:Date.now()};
            }}
            onTouchEnd={(e) => {
              const start=swipe.current;
              swipe.current=null;
              if (!start || gesture.current?.drag || e.changedTouches.length!==1) return;
              const dx=e.changedTouches[0].clientX-start.x;
              const dy=e.changedTouches[0].clientY-start.y;
              // Reject vertical/diagonal gestures; short quick flicks still switch pages.
              if(Math.abs(dx)<48 || Math.abs(dx)<Math.abs(dy)*1.35) return;
              const p=s.pages[pageIndex+(dx<0?1:-1)];
              if(p){setSwipeDirection(dx<0?"left":"right");s.set({pageId:p.id});}
            }}
            onWheel={(e) => {
              if(gesture.current?.drag || Math.abs(e.deltaX)<35 || Math.abs(e.deltaX)<Math.abs(e.deltaY)*1.3)return;
              const p=s.pages[pageIndex+(e.deltaX>0?1:-1)];
              if(p){setSwipeDirection(e.deltaX>0?"left":"right");s.set({pageId:p.id});}
            }}
          >
            <div className="clock">
              <span className="eyebrow">
                {now
                  .toLocaleDateString("en-US", { weekday: "long" })
                  .toUpperCase()}
              </span>
              <h2>
                {now.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </h2>
              <p>
                {now.toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}{" "}
                <span>· 好好生活</span>
              </p>
            </div>
            {s.editing && (
              <div className="edit-tools">
                <button
                  onClick={() => {
                    const id = crypto.randomUUID();
                    void s.saveDesktop(s.items, [
                      ...s.pages,
                      { id, order: s.pages.length },
                    ]);
                    s.set({ pageId: id });
                  }}
                >
                  <Plus size={14} />
                  页面
                </button>
                <button
                  onClick={() =>
                    void s.saveDesktop([
                      ...s.items,
                      {
                        id: crypto.randomUUID(),
                        kind: "widget",
                        widget: "calendar",
                        pageId: s.pageId,
                        position: Date.now(),
                        size: 2,
                      },
                    ])
                  }
                >
                  <Plus size={14} />
                  小组件
                </button>
                <button onClick={backPhonePage}>
                  <Check size={14} />
                  完成
                </button>
              </div>
            )}
            <div className={`grid desktop-page desktop-page--${swipeDirection}`} key={s.pageId}>
              {pageItems.map((item) => {
                const Icon = item.app==='剧本'?BookOpen:item.app==='忍一下嘛'?Flower2:icons[apps.indexOf(item.app || "")] || Flower2;
                return (
                  <div
                    key={item.id}
                    data-item={item.id}
                    className={`desktop-item ${item.kind === "widget" ? "widget glass" : ""} ${drag === item.id ? "dragging" : ""}`}
                    style={{
                      gridColumn: `span ${item.kind === "widget" ? item.size : 1}`,
                      ...(drag===item.id ? {opacity:0.2} : {}),
                    }}
                    onPointerDown={(e) => start(e, item.id)}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <button
                      className="item-button"
                      aria-label={item.app || "小组件"}
                      onClick={() => {
                        if (suppress.current) {
                          suppress.current = false;
                          return;
                        }
                        if (!s.editing && item.app)
                          openPhoneApp(item.app);
                      }}
                    >
                      {item.kind === "widget" ? (
                        widget(item)
                      ) : (
                        <>
                          <span
                            className="app-icon glass"
                            style={{
                              borderRadius:
                                appearance.iconStyle === "squircle"
                                  ? "50%"
                                  : undefined,
                            }}
                          >
                            {asset(item.icon) ? (
                              <img
                                draggable={false}
                                src={asset(item.icon)}
                                alt=""
                              />
                            ) : (
                              <Icon size={29} strokeWidth={1.45} />
                            )}
                          </span>
                          <span className="app-label">{item.app}</span>
                        </>
                      )}
                    </button>
                    {s.editing && item.id!=='virtual-story-app' && (
                      <div
                        className="item-edit"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {item.kind === "widget" ? (
                          <>
                            <button
                              aria-label="删除小组件"
                              onClick={() =>
                                void s.saveDesktop(
                                  s.items.filter((i) => i.id !== item.id),
                                )
                              }
                            >
                              <X size={13} />
                            </button>
                            <button
                              aria-label="调整小组件尺寸"
                              onClick={() =>
                                void s.saveDesktop(
                                  s.items.map((i) =>
                                    i.id === item.id
                                      ? {
                                          ...i,
                                          size:
                                            i.size === 4
                                              ? 2
                                              : i.size === 2
                                                ? 1
                                                : 4,
                                        }
                                      : i,
                                  ),
                                )
                              }
                            >
                              ↔
                            </button>
                            <select
                              aria-label="小组件类型"
                              value={item.widget}
                              onChange={(e) =>
                                void s.saveDesktop(
                                  s.items.map((i) =>
                                    i.id === item.id
                                      ? {
                                          ...i,
                                          widget: e.target.value as "quote",
                                        }
                                      : i,
                                  ),
                                )
                              }
                            >
                              <option value="quote">语录</option>
                              <option value="calendar">日历</option>
                              <option value="note">便签</option>
                            </select>
                          </>
                        ) : (
                          <span>
                            <Grip size={12} />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {pageItems.length === 0 && (
              <p className="empty-page">
                一张留白，等待你的故事。
                <br />
                编辑模式下将图标拖到下方圆点即可移入此页。
              </p>
            )}
            {drag && dragPoint && (() => {
              const item=displayItems.find(i=>i.id===drag);
              if(!item)return null;
              const Icon=item.app==='忍一下嘛'?Flower2:icons[apps.indexOf(item.app||"")]||Flower2;
              return createPortal(<div className="desktop-drag-ghost" style={{left:dragPoint.x-dragAnchor.x,top:dragPoint.y-dragAnchor.y}} aria-hidden="true">
                {item.kind==="app"?<><span className="app-icon glass">{asset(item.icon)?<img src={asset(item.icon)} alt=""/>:<Icon size={29}/>}</span><span className="app-label">{item.app}</span></>:widget(item)}
              </div>,document.body);
            })()}
            <div className="page-dots">
              {s.pages.map((p, i) => (
                <button
                  data-page={p.id}
                  aria-label={`桌面第${i + 1}页`}
                  className={`${s.pageId === p.id ? "active" : ""} ${hoverPage === p.id ? "drop-target" : ""}`}
                  key={p.id}
                  onClick={() => s.set({ pageId: p.id })}
                />
              ))}
              {s.editing && <span>拖到圆点以跨页移动</span>}
            </div>
            <div className="dock glass">
              {[0, 2, 10, 8].map((index) => {
                const Icon = icons[index];
                return (
                  <button
                    key={index}
                    aria-label={`Dock ${apps[index]}`}
                    onClick={() => {
                      if (!s.editing) openPhoneApp(apps[index]);
                    }}
                  >
                    <Icon size={27} strokeWidth={1.4} />
                  </button>
                );
              })}
            </div>
            {!environment.ios && <div className="home-indicator" />}
          </section>
        )}
        {s.error && (
          <div className="toast" role="alert">
            {s.error}
            <button aria-label="关闭提示" onClick={() => s.set({ error: "" })}>
              <X size={18} />
            </button>
          </div>
        )}
        {busy && (
          <div className="toast" role="status">
            正在处理并保存图片…
          </div>
        )}
      </main>
      <aside className="side-note">
        <span>01 / YOUR EVERYDAY ESCAPE</span>
        <p>
          留一点空白，
          <br />
          装下无限可能。
        </p>
        <small>长按图标，开始定制你的桌面。</small>
      </aside>
    </div>
  );
}
initializeAudioKeepAlive();
installMemorySummaryScheduler();
createRoot(document.getElementById("root")!).render(
  <><SpaceRoot phone={<App />} /><BackgroundReplyReconciler/><GlobalChatNotifications/></>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", {updateViaCache:"none"})
      .then((registration) => {
        // Update on foreground entry without reloading forms or interrupting chat.
        const update = () => { if (!document.hidden) void registration.update().catch(() => {}); };
        update();
        document.addEventListener("visibilitychange",update);
        window.addEventListener("pageshow",update);
      })
      .catch(() =>
        usePhone
          .getState()
          .set({ error: "离线缓存不可用，在线功能仍可使用。" }),
      );
  });

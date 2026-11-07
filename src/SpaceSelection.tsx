import { usePageCanvas } from "./presentation";
import appleLeopardUrl from "./assets/apple-leopard.png";
import { startBackupPresence } from "./backupGate";
import { DataBackups } from "./DataBackups";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { liveQuery } from "dexie";
import {
  ArrowRight,
  ChevronLeft,
  Sun,
  Orbit,
} from "lucide-react";
import { db, usePhone } from "./store";
import { useSpaces } from "./spaces";
import { Worlds } from "./Worlds";
export function SpaceRoot({ phone }: { phone: ReactNode }) {
  const s = usePhone();
  const nav = useSpaces();
  usePageCanvas(!!nav.space && !nav.transitioning && s.activeApp !== "数据备份与恢复", s.activeApp, s.theme, s.assets);
  useEffect(() => {
    const stopPresence = startBackupPresence();
    let alive = true;
    void s.init().then(() => {
      if (alive) void useSpaces.getState().restoreCurrentSpace();
    });
    const back = () => {
      void useSpaces.getState().restoreUrl();
    };
    window.addEventListener("popstate", back);
    window.addEventListener("hashchange", back);
    return () => {
      alive = false;
      stopPresence();
      window.removeEventListener("popstate", back);
      window.removeEventListener("hashchange", back);
    };
  }, []);
  useEffect(() => {
    if (s.ready) void nav.reconcile();
  }, [s.worlds, s.ready, nav.booted, nav.transitioning, nav.space]);
  if (!s.ready || !nav.booted || nav.transitioning)
    return (
      <main className="space-selection">
        <p role="status">正在打开你的空间…</p>
      </main>
    );
  if (nav.space)
    return (
      <Fragment key={nav.space.spaceId}>
        {s.activeApp === "数据备份与恢复" ? <DataBackups /> : phone}
      </Fragment>
    );
  return (
    <main className="space-selection">
      <div className="space-select-shell">
        {nav.notice && nav.notice !== s.error && (
          <p className="space-notice" role="status">
            {nav.notice}
          </p>
        )}
        {s.restoreNotice&&<p className="space-notice" role={s.restoreNotice.startsWith("导入成功")?"status":"alert"}>{s.restoreNotice}</p>}
        {s.error && (
          <p className="space-notice" role="alert">
            {s.error}
          </p>
        )}
        {nav.route.screen === "worlds" ? <ScriptSpaces /> : <SpaceSelection />}
      </div>
    </main>
  );
}
function SpaceSelection() {
  const nav = useSpaces();
  const [mascotState, setMascotState] = useState<"loading" | "ready" | "failed">("loading");
  return (
    <section className="space-landing" aria-label="空间入口">
      <header className="space-heading">
        <span className="eyebrow">CLAUDIA PHONE</span>
        <h1>选择空间</h1>
        <p>日常与故事，各有归处。</p>
      </header>
      <div className="space-mascot" aria-busy={mascotState === "loading"}>
        {mascotState !== "failed" ? (
          <img src={appleLeopardUrl} width="1635" height="962"
            alt="头顶浅绿苹果、闭眼微笑的手绘小豹子" draggable={false}
            style={{ visibility: mascotState === "ready" ? "visible" : "hidden" }}
            onLoad={(event) => {
              const image = event.currentTarget;
              void image.decode().then(
                () => setMascotState("ready"),
                () => setMascotState("failed"),
              );
            }}
            onError={() => setMascotState("failed")} />
        ) : <p className="hint" role="status">插画暂时未能加载</p>}
      </div>
      <nav className="space-entry-actions" aria-label="选择手机空间">
        <button data-testid="daily-space" aria-label="进入日常手机"
          onClick={() => void nav.enterSpace("daily")}>
          <Sun aria-hidden="true" size={21} /><span>日常</span><ArrowRight aria-hidden="true" size={18} />
        </button>
        <button aria-label="剧本" onClick={() => void nav.manageWorlds()}>
          <Orbit aria-hidden="true" size={22} /><span>剧本</span><ArrowRight aria-hidden="true" size={18} />
        </button>
      </nav>
    </section>
  );
}

function ScriptSpaces() {
  const s = usePhone();
  const nav = useSpaces();
  const [archiveWorld, setArchiveWorld] = useState<string | null>(null);
  const [progress, setProgress] = useState<Set<string> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const sub = liveQuery(async () => {
      if (!s.worlds.length) return new Set<string>();
      const rows = await db.conversations
        .where("worldId")
        .anyOf(s.worlds.map((w) => w.id))
        .toArray();
      const found = await Promise.all(
        rows
          .filter((c) => c.mode === "world")
          .map(async (c) =>
            ((await db.messages.where("conversationId").equals(c.id).count()) ||
             (await db.conversationSnapshots.where("conversationId").equals(c.id).count()))
              ? c.worldId
              : undefined,
          ),
      );
      return new Set(found.filter((id): id is string => !!id));
    }).subscribe({
      next: (value) => {
        setProgress(value);
        setError("");
      },
      error: () => {
        setProgress(null);
        setError("聊天进度暂不可读取，进入空间不会覆盖已有记录。");
      },
    });
    return () => sub.unsubscribe();
  }, [s.worlds]);

  return <>
    <button className="space-back" onClick={() => void nav.exitSpace()}>
      <ChevronLeft size={18} />{nav.route.screen === "worlds" && nav.route.view ? "返回剧本列表" : "返回空间首页"}
    </button>
    {error && <p className="space-notice" role="alert">{error}</p>}
    <Worlds key={nav.route.screen === "worlds" ? `${nav.route.view || "list"}:${nav.route.worldId || ""}` : "list"} spaceList onEnterWorld={(id) => void nav.enterSpace(`world:${id}`)} onCharacters={(id) => {
      void nav.enterSpace(`world:${id}`).then(() => {
        if (useSpaces.getState().space?.worldId === id)
          usePhone.getState().set({ activeApp: "角色管理" });
      });
    }} renderSpaceInfo={(w) => <span className="space-badge">{progress ? progress.has(w.id) ? "已有聊天进度" : "尚无聊天进度" : "进度暂不可读取"}</span>}
    renderSpaceDetails={(w) => archiveWorld === w.id ? <ArchiveOverview worldId={w.id} onClose={() => setArchiveWorld(null)} /> : null}
    renderSpaceActions={(w) => {
      const hasProgress = progress?.has(w.id);
      const action = progress ? hasProgress ? "继续游戏" : "开始新游戏" : "进入世界";
      return <>

          <button className="primary" aria-label={`${action} · ${w.name}`}
            onClick={() => void nav.enterSpace(`world:${w.id}`)}>{action}<ArrowRight size={16}/></button>

          <button aria-label={`存档管理 · ${w.name}`} onClick={() => setArchiveWorld(archiveWorld === w.id ? null : w.id)}>存档管理</button>

      </>;
    }} />

  </>;
}
function ArchiveOverview({worldId, onClose}: {worldId: string; onClose: () => void}) {
  const s = usePhone();
  const [rows, setRows] = useState<{id:string;characterId:string;messages:number;snapshots:number}[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const sub = liveQuery(async () => {
      const conversations = (await db.conversations.where("worldId").equals(worldId).toArray()).filter(c=>c.mode === "world");
      return Promise.all(conversations.map(async c => ({id:c.id,characterId:c.characterId,
        messages:await db.messages.where("conversationId").equals(c.id).count(),
        snapshots:await db.conversationSnapshots.where("conversationId").equals(c.id).count()})));
    }).subscribe({next: setRows,error:()=>setError("无法读取存档信息，请稍后重试；现有记录未改变。")});
    return () => sub.unsubscribe();
  }, [worldId]);
  return <section className="script-archives" aria-label="存档管理">
    <h4>现有会话与历史快照</h4>
    <p>这里展示已有数据，不提供独立存档槽或重置进度。恢复已有快照：进入聊天 → 选择角色 → 会话管理 → 历史快照 / 分支恢复。</p>
    {error ? <p role="alert">{error}</p> : rows ? rows.length ? rows.map(r=><p key={r.id}>{s.characters.find(c=>c.id===r.characterId)?.name || "未命名角色"}：{r.messages} 条消息 · {r.snapshots} 个历史快照</p>) : <p>暂无会话或快照。</p> : <p role="status">正在读取存档信息…</p>}
    <div className="actions"><button onClick={() => {
      void useSpaces.getState().enterSpace(`world:${worldId}`).then(() => {
        if(useSpaces.getState().space?.worldId===worldId) usePhone.getState().set({activeApp:"聊天"});
      });
    }}>进入该剧本聊天</button><button onClick={onClose}>关闭存档信息</button></div>
  </section>;
}

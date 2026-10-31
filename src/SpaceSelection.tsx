import appleLeopardUrl from "./assets/apple-leopard.png";
import { startBackupPresence } from "./backupGate";
import { DataBackups } from "./DataBackups";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { liveQuery } from "dexie";
import {
  ArrowRight,
  ChevronLeft,
  Globe2,
  Plus,
  Smartphone,
  Sun,
  Orbit,
} from "lucide-react";
import { db, usePhone } from "./store";
import { useSpaces } from "./spaces";
import { Worlds } from "./Worlds";
export function SpaceRoot({ phone }: { phone: ReactNode }) {
  const s = usePhone();
  const nav = useSpaces();
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
        {s.error && (
          <p className="space-notice" role="alert">
            {s.error}
          </p>
        )}
        {nav.route.screen === "worlds" ? (
          <>
            <button className="space-back" onClick={() => void nav.exitSpace()}>
              <ChevronLeft size={18} />
              返回空间列表
            </button>
            <Worlds
              onCharacters={(id) => {
                void nav.enterSpace(`world:${id}`).then(() => {
                  if (useSpaces.getState().space?.worldId === id)
                    usePhone.getState().set({ activeApp: "角色管理" });
                });
              }}
            />
          </>
        ) : (
          <SpaceSelection />
        )}
      </div>
    </main>
  );
}
function SpaceSelection() {
  const s = usePhone();
  const nav = useSpaces();
  const [scripts, setScripts] = useState(false);
  const [mascotState, setMascotState] = useState<"loading" | "ready" | "failed">("loading");
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
            (await db.messages.where("conversationId").equals(c.id).count())
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
  if (!scripts) return (
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
        <button aria-label="剧本" onClick={() => setScripts(true)}>
          <Orbit aria-hidden="true" size={22} /><span>剧本</span><ArrowRight aria-hidden="true" size={18} />
        </button>
      </nav>
    </section>
  );
  return (
    <>
      <button className="space-back" onClick={() => setScripts(false)}>
        <ChevronLeft size={18} />返回空间首页
      </button>
      <header className="space-heading">
        <span className="eyebrow">CLAUDIA PHONE</span>
        <h1>选择空间</h1>
        <p>日常与故事，各有归处。</p>
      </header>
      <article className="space-card space-daily" data-testid="daily-space">
        <Smartphone size={28} />
        <span className="space-badge">永久空间</span>
        <h2>日常手机</h2>
        <p>独立于所有剧本的日常空间。</p>
        <button
          className="primary"
          onClick={() => void nav.enterSpace("daily")}
        >
          进入日常手机
          <ArrowRight size={17} />
        </button>
      </article>
      <div className="space-world-heading">
        <h2>剧本世界</h2>
        <button onClick={() => void nav.manageWorlds()}>
          <Plus size={16} />
          创建 / 管理剧本
        </button>
      </div>
      {error && (
        <p className="space-notice" role="alert">
          {error}
        </p>
      )}
      {!s.worlds.length && (
        <div className="space-empty">
          <Globe2 size={30} />
          <p>还没有剧本世界。你可以先进入日常手机，也可以创建自己的剧本。</p>
          <button onClick={() => void nav.manageWorlds()}>创建剧本</button>
        </div>
      )}
      <div className="space-world-grid">
        {s.worlds.map((w) => {
          const hasProgress = progress?.has(w.id);
          const action = progress
            ? hasProgress
              ? "继续游戏"
              : "开始游戏"
            : "进入世界";
          return (
            <article
              className="space-card"
              key={w.id}
              data-testid={`world-space-${w.id}`}
            >
              <Globe2 size={24} />
              <h3>{w.name}</h3>
              <p className="space-description">
                {w.description || "故事背景，由你书写。"}
              </p>
              <span className="space-badge">
                {progress
                  ? hasProgress
                    ? "已有聊天进度"
                    : "尚无聊天进度"
                  : error
                    ? "进度暂不可读取"
                    : "正在读取聊天进度…"}
              </span>
              <button
                className={hasProgress ? "primary" : "space-start"}
                aria-label={`${action} · ${w.name}`}
                onClick={() => void nav.enterSpace(`world:${w.id}`)}
              >
                {action}
                <ArrowRight size={16} />
              </button>
            </article>
          );
        })}
      </div>
      <p className="space-scope-note">
        聊天沿用日常 /
        世界隔离。当前桌面、壁纸、图标和主题仍共用；其他应用尚未实现空间独立数据。
      </p>
    </>
  );
}

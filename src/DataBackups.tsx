import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, FileCheck, ShieldCheck, X } from "lucide-react";
import { usePhone } from "./store";
import {
  createBackup,
  readBackup,
  type BackupExport,
  type ReadbackResult,
  type IntegrityReport,
} from "./backupService";
import { publicBackupError, checkAbort } from "./backupFormat";
export function DataBackups() {
  const s = usePhone();
  const [closed, setClosed] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [output, setOutput] = useState<BackupExport | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [candidate, setCandidate] = useState<ReadbackResult | null>(null);
  const [prepared, setPrepared] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const control = useRef<AbortController | null>(null);
  const task = useRef<Promise<void>>(Promise.resolve());
  const outputRef = useRef<BackupExport | null>(null);
  const candidateRef = useRef<ReadbackResult | null>(null);
  const mounted = useRef(true);
  const urlRef = useRef("");
  useEffect(() => {
    // Release the pre-existing whole-image UI cache while the maintenance page
    // is active. No asset rows or references are changed.
    usePhone.getState().set({ assets: [] });
    const hidden = () => {
      if (document.hidden) control.current?.abort();
    };
    const leave = () => control.current?.abort();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      mounted.current = false;
      control.current?.abort();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      void task.current.then(async () => {
        await outputRef.current?.dispose().catch(() => {});
        await candidateRef.current?.dispose().catch(() => {});
        await usePhone
          .getState()
          .reload()
          .catch(() =>
            usePhone.getState().set({
              error:
                "返回手机时图片缓存读取失败，请刷新重试；图片记录未被删除。",
            }),
          );
      });
    };
  }, []);
  function run(work: (signal: AbortSignal) => Promise<void>) {
    if (control.current) return;
    const controller = new AbortController();
    control.current = controller;
    setBusy(true);
    setError("");
    setProgress("正在准备…");
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    task.current = (async () => {
      try {
        await work(controller.signal);
      } catch (e) {
        if (mounted.current) {
          setError(publicBackupError(e));
          setProgress("");
        }
      } finally {
        clearTimeout(timeout);
        control.current = null;
        if (mounted.current) {
          setBusy(false);
          setPassword("");
          setRepeat("");
        }
      }
    })();
  }
  const onProgress = (p: {
    phase: string;
    table?: string;
    records: number;
    bytes: number;
  }) => {
    if (mounted.current)
      setProgress(
        `${p.phase}${p.table ? ` · ${p.table}` : ""} · ${p.records}条 · ${(p.bytes / 1048576).toFixed(1)}MiB`,
      );
  };
  async function prepare(name: string, blob: Blob) {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setPrepared({ name, url });
  }
  function exportData() {
    if (!closed) {
      setError("请先关闭其他标签页及独立PWA，并勾选确认。");
      return;
    }
    if (sensitive && (password.length < 12 || password !== repeat)) {
      setError("请填写至少12字符的密码，并确保两次一致。");
      return;
    }
    if (
      sensitive &&
      !confirm(
        "将独立API Key及敏感API地址包含在加密数据分卷中？请保管密码，忘记后无法恢复。候选演练解密后会含本地凭据。",
      )
    )
      return;
    run(async (signal) => {
      await outputRef.current?.dispose();
      outputRef.current = null;
      setOutput(null);
      setFiles([]);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = "";
      setPrepared(null);
      setReport(null);
      const value = await createBackup({
        closedOtherClients: closed,
        includeCredentials: sensitive,
        credentialConsent: sensitive,
        password,
        signal,
        onProgress,
      });
      if (!mounted.current || signal.aborted) {
        await value.dispose();
        checkAbort(signal);
        return;
      }
      outputRef.current = value;
      setOutput(value);
      setProgress("快照已准备，请保存清单和全部分卷。尚未完成文件读回验证。");
    });
  }
  function inspect(mode: "verify" | "rehearse") {
    if (!files.length) {
      setError("请从文件App重新选择清单与全部分卷，下载完成不等于验证成功。");
      return;
    }
    if (
      mode === "rehearse" &&
      !confirm(
        "仅恢复到新建的隔离候选数据库，并占用额外本地空间；不会覆盖正式数据库。继续演练？",
      )
    )
      return;
    run(async (signal) => {
      setReport(null);
      await candidateRef.current?.dispose();
      candidateRef.current = null;
      setCandidate(null);
      const result = await readBackup(files, {
        mode,
        password,
        signal,
        onProgress,
      });
      if (!mounted.current || signal.aborted) {
        await result.dispose();
        checkAbort(signal);
        return;
      }
      candidateRef.current = result;
      setCandidate(mode === "rehearse" ? result : null);
      setReport(result.report);
      setProgress(
        mode === "rehearse"
          ? "候选恢复演练通过。正式数据库未被覆盖。"
          : "备份已验证（仅本次重新选择的文件）。恢复演练仍需单独完成。",
      );
    });
  }
  return (
    <main className="space-selection">
      <div className="space-select-shell backup-page">
        <button
          className="space-back"
          onClick={() => {
            control.current?.abort();
            s.set({ activeApp: "设置" });
          }}
        >
          <ChevronLeft size={18} />
          返回设置
        </button>
        <div className="page-title">
          <h1>数据备份与恢复</h1>
          <p>本地维护 · 正式数据库为 v6（兼容读取 v5 备份）</p>
        </div>
        <div className="card">
          <p>
            备份包含用户身份、聊天、角色、世界书和图片等隐私。默认不导出独立 API Key，API
            地址中的敏感部分也会省略，但用户文本仍可能含秘密。文件不会自动上传；在“文件”App选择云盘可能由系统同步。
          </p>
          <p>
            请保持前台。进入后台、取消、空间不足或一致性无法确认时会失败，不会显示成功。备份器逐条处理；单条记录超过16MiB会停止，不会丢弃记录。
          </p>
        </div>
        <section className="card form">
          <h2>
            <Download size={18} />
            导出备份
          </h2>
          <label className="backup-check">
            <input
              type="checkbox"
              checked={closed}
              disabled={busy}
              onChange={(e) => setClosed(e.target.checked)}
            />
            我已关闭其他 Claudia Phone 标签页和独立 PWA
          </label>
          <p className="hint">
            这项确认不是跨标签锁。当前客户端禁止写入，原生18表只读事务阻挡其他连接写入；旧客户端无法自动确认时仍必须手动关闭。
          </p>
          <label className="backup-check">
            <input
              type="checkbox"
              checked={sensitive}
              disabled={busy}
              onChange={(e) => setSensitive(e.target.checked)}
            />
            另选：包含凭据，并加密全部数据分卷
          </label>
          {sensitive && (
            <>
              <label>
                备份加密密码
                <input
                  type="password"
                  aria-label="备份加密密码"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                再次输入密码
                <input
                  type="password"
                  aria-label="再次输入密码"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </label>
              <p className="hint">
                清单仍包含表计数和资源ID；数据分卷使用密码加密。密码不上传、不保存。
              </p>
            </>
          )}
          <button className="primary" disabled={busy} onClick={exportData}>
            导出备份
          </button>
        </section>
        {output && (
          <section className="card">
            <h2>保存全部文件</h2>
            <p>
              共 {output.manifest.parts.length}{" "}
              个数据分卷及1个清单。请逐个准备并点击保存；iPhone若打开预览，请使用系统分享存到“文件”。
            </p>
            <p className="hint">
              快照截止：
              {new Date(output.manifest.snapshotCompletedAt).toLocaleString()}
              。之后的修改不在本次快照中。
            </p>
            <p className="hint">{output.manifest.coordination}</p>
            <button
              disabled={busy}
              onClick={() =>
                void prepare(
                  `${output.manifest.backupId}.manifest.json`,
                  new Blob([JSON.stringify(output.manifest)], {
                    type: "application/json",
                  }),
                )
              }
            >
              准备清单文件
            </button>
            <div className="backup-volumes">
              {output.manifest.parts.map((p) => (
                <button
                  key={p.index}
                  disabled={busy}
                  onClick={() => {
                    void output
                      .readPart(p.index)
                      .then((blob) => prepare(p.name, blob))
                      .catch((e) => setError(publicBackupError(e)));
                  }}
                >
                  准备分卷 {p.index + 1}（{(p.bytes / 1048576).toFixed(1)}MiB）
                </button>
              ))}
            </div>
            {prepared && (
              <a
                className="primary backup-download"
                href={prepared.url}
                download={prepared.name}
              >
                点击保存：
                {prepared.name.endsWith(".json") ? "清单" : "当前分卷"}
              </a>
            )}
          </section>
        )}
        <section className="card form">
          <h2>
            <FileCheck size={18} />
            从文件App读回
          </h2>
          <label>
            选择清单和全部分卷
            <input
              type="file"
              aria-label="选择备份文件"
              multiple
              accept=".json,.cphone,application/json,application/octet-stream"
              disabled={busy}
              onChange={(e) => {
                setFiles(Array.from(e.target.files || []));
                setReport(null);
                setError("");
                e.target.value = "";
              }}
            />
          </label>
          <p>
            已选择 {files.length}{" "}
            个文件。仅在重新读取文件并完成全部检查后，才能显示“备份已验证”。
          </p>
          {!sensitive && (
            <label>
              加密文件的密码（如需）
              <input
                type="password"
                aria-label="解密备份密码"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          <div className="actions">
            <button disabled={busy} onClick={() => inspect("verify")}>
              验证备份
            </button>
            <button disabled={busy} onClick={() => inspect("rehearse")}>
              恢复演练
            </button>
          </div>
          <p className="hint">
            候选库只用于校验，不启动聊天或模型请求。即使含Key，也只是本浏览器的客户端凭据。这里没有覆盖正式数据库按钮，也没有v6升级或空间迁移。
          </p>
        </section>
        {busy && (
          <button
            className="text-button"
            onClick={() => control.current?.abort()}
          >
            <X size={16} />
            取消当前操作
          </button>
        )}
        {progress && (
          <p role="status" className="space-notice">
            {progress}
          </p>
        )}
        {error && (
          <p role="alert" className="space-notice">
            {error}
          </p>
        )}
        {report && (
          <section className="card backup-report" aria-label="校验报告">
            <h2>
              <ShieldCheck size={18} />
              校验报告
            </h2>
            <p>
              {report.status === "rehearsed"
                ? "候选恢复演练通过"
                : "备份已验证"}
            </p>
            <p>
              v{report.schemaVersion} · {report.totalRecords} 条 · {report.parts} 卷 ·{" "}
              {report.resources} 个图片资源
            </p>
            <p>
              全部表记录读回摘要匹配；主键及硬引用检查通过。正式数据库未写入。
            </p>
            <p className="hint">清单摘要：{report.manifestDigest}</p>
            <p className="hint">
              备份ID：{report.backupId} · 快照截止：
              {new Date(report.snapshotCompletedAt).toLocaleString()}
            </p>
            {report.candidateName && (
              <p className="hint">候选库：{report.candidateName}</p>
            )}
            <details>
              <summary>查看全部表计数</summary>
              {Object.entries(report.counts).map(([name, count]) => (
                <p key={name}>
                  {name}：{count}
                </p>
              ))}
            </details>
            {report.warnings.map((w) => (
              <p className="hint" key={w}>
                {w}
              </p>
            ))}
            {candidate && (
              <button
                disabled={busy}
                onClick={() => {
                  void candidate
                    .dispose()
                    .then(() => {
                      candidateRef.current = null;
                      setCandidate(null);
                    })
                    .catch((e) => setError(publicBackupError(e)));
                }}
              >
                删除本次候选库（不影响正式库）
              </button>
            )}
            <p className="hint">
              本报告只验证这份文件，不代表未发送草稿或快照截止后的修改已保存。进入B2必须先由用户在真实iPhone完成读回和演练确认。
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

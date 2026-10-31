export function compileLoreRegex(value: string, caseSensitive = false) {
  let source = value;
  let flags = caseSensitive ? "" : "i";
  if (value.startsWith("/")) {
    const end = value.lastIndexOf("/");
    if (end <= 0) throw Error("正则缺少结束斜线。");
    source = value.slice(1, end);
    flags = value.slice(end + 1);
  }
  if (!source || source.length > 200) throw Error("正则长度需为 1–200 字符。");
  return new RegExp(source, flags);
}
export function regexError(keys: string[], caseSensitive = false) {
  try {
    for (const k of keys) compileLoreRegex(k, caseSensitive);
    return "";
  } catch {
    return "正则无效：请检查表达式、斜线和 flags。";
  }
}
export interface RegexJob {
  id: string;
  text: string;
  primary: string[];
  secondary: string[];
  caseSensitive: boolean;
  spans?: {id:string;role:"user"|"assistant";start:number;end:number}[];
}
export interface RegexHits {
  matches?: {id:string;role:"user"|"assistant"}[];
  crossMessageMatch?: boolean;
  primary: boolean[];
  secondary: boolean[];
  error?: string;
}
/** Untrusted regex execution is isolated and terminated on timeout; no key or chat logging. */
export async function evaluateRegex(
  jobs: RegexJob[],
): Promise<Record<string, RegexHits>> {
  if (!jobs.length) return {};
  return new Promise((resolve) => {
    const fallback = () =>
      Object.fromEntries(
        jobs.map((j) => [
          j.id,
          {
            primary: [],
            secondary: [],
            error: "正则测试超时或不可用，该条目本轮未激活。",
          },
        ]),
      );
    let worker: Worker;
    try {
      worker = new Worker(new URL("./loreRegexWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      resolve(fallback());
      return;
    }
    const finish = (result: Record<string, RegexHits>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish(fallback()), 1000);
    worker.onmessage = (e) => finish(e.data);
    worker.onerror = () => finish(fallback());
    worker.postMessage(jobs);
  });
}

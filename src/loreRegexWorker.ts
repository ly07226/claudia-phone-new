import { compileLoreRegex, type RegexJob, type RegexHits } from "./loreRegex";
self.onmessage = (event: MessageEvent<RegexJob[]>) => {
  const result: Record<string, RegexHits> = {};
  for (const job of event.data) {
    try {
      const hit = (s: string) =>
        compileLoreRegex(s, job.caseSensitive).test(job.text);
      result[job.id] = {
        primary: job.primary.map(hit),
        secondary: job.secondary.map(hit),
      };
    } catch {
      result[job.id] = {
        primary: [],
        secondary: [],
        error: "正则无效，该条目未激活。",
      };
    }
  }
  self.postMessage(result);
};

import { compileLoreRegex, type RegexJob, type RegexHits } from "./loreRegex";
self.onmessage = (event: MessageEvent<RegexJob[]>) => {
  const result: Record<string, RegexHits> = {};
  for (const job of event.data) {
    try {
      const matches = new Map<string, {id:string;role:"user"|"assistant"}>();
      let crossMessageMatch = false;
      const hit = (s: string) => {
        const match = compileLoreRegex(s, job.caseSensitive).exec(job.text);
        if (!match) return false;
        const start = match.index, end = start + match[0].length;
        const origins = (job.spans || []).filter(span => end > start ? span.start < end && span.end > start : span.start <= start && span.end >= start);
        crossMessageMatch ||= origins.length > 1;
        for (const origin of origins) matches.set(origin.id,{id:origin.id,role:origin.role});
        return true;
      };
      result[job.id] = {
        primary: job.primary.map(hit),
        secondary: job.secondary.map(hit),
        matches: [...matches.values()],
        crossMessageMatch,
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

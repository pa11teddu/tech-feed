import { parseFeed } from "./feeds";
import { Fetcher } from "./fetcher";
import type { SourceSeed } from "./types";

export interface SourceCheck {
  source: SourceSeed;
  ok: boolean;
  items: number;
  newest: string | null;
  detail: string;
}

/** Fetch and parse every source URL; a source passes when its feed fetches (2xx) and parses. */
export async function verifySources(sources: readonly SourceSeed[], fetcher: Fetcher): Promise<SourceCheck[]> {
  return Promise.all(
    sources.map(async (source): Promise<SourceCheck> => {
      try {
        const res = await fetcher.get(source.url);
        if (!res.ok) return { source, ok: false, items: 0, newest: null, detail: `HTTP ${res.status}` };
        const entries = await parseFeed(res.text);
        const newest = entries
          .map((e) => e.publishedAt)
          .filter((d): d is string => d !== null)
          .sort()
          .at(-1) ?? null;
        // A well-formed feed with zero items passes: status feeds are empty when nothing is wrong.
        return {
          source,
          ok: true,
          items: entries.length,
          newest,
          detail: entries.length > 0 ? "parsed" : "valid feed, currently empty",
        };
      } catch (err) {
        return { source, ok: false, items: 0, newest: null, detail: (err as Error).message.slice(0, 80) };
      }
    }),
  );
}

export function formatVerificationTable(checks: readonly SourceCheck[]): string {
  const rows = checks.map((c) => [
    c.ok ? "PASS" : "FAIL",
    c.source.stream,
    c.source.fetch_mode,
    c.source.name,
    String(c.items),
    c.newest ? c.newest.slice(0, 10) : "-",
    c.ok && c.items > 0 ? "" : c.detail,
  ]);
  const header = ["result", "stream", "mode", "source", "items", "newest", "detail"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" | ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("-|-"), ...rows.map(line)].join("\n");
}

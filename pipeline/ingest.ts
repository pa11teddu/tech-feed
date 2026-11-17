import { canonicalizeUrl } from "@/lib/url";
import { fetchArticle } from "./article";
import { parseFeed, type FeedEntry } from "./feeds";
import type { Fetcher } from "./fetcher";
import type { NewRawItem, Source, Store } from "./types";

export const MAX_ITEM_AGE_HOURS = 48;

export interface IngestOptions {
  store: Store;
  fetcher: Fetcher;
  now: Date;
  /** Max new items this run (round-robin across sources). */
  limit?: number;
  log: (msg: string) => void;
}

export interface IngestCounts {
  sources_ok: number;
  source_errors: number;
  items_seen: number;
  items_new: number;
  pages_fetched: number;
  pages_fallback: number;
}

interface Candidate {
  source: Source;
  entry: FeedEntry;
  url: string;
}

function isFresh(entry: FeedEntry, now: Date): boolean {
  if (!entry.publishedAt) return true;
  const ageHours = (now.getTime() - new Date(entry.publishedAt).getTime()) / 3_600_000;
  return ageHours <= MAX_ITEM_AGE_HOURS;
}

async function collectFromSource(source: Source, opts: IngestOptions): Promise<Candidate[]> {
  const res = await opts.fetcher.get(source.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const entries = await parseFeed(res.text);
  const newest = [...entries]
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, source.max_items_per_run)
    .filter((e) => isFresh(e, opts.now));
  const out: Candidate[] = [];
  for (const entry of newest) {
    const url = canonicalizeUrl(entry.link, source.url);
    if (url) out.push({ source, entry, url });
  }
  return out;
}

/** Interleave sources so --limit samples every stream instead of the first feed. */
function roundRobin(groups: Candidate[][], limit: number): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; out.length < limit; i++) {
    let added = false;
    for (const g of groups) {
      const c = g[i];
      if (c && out.length < limit) {
        out.push(c);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

export async function ingest(opts: IngestOptions): Promise<IngestCounts> {
  const counts: IngestCounts = {
    sources_ok: 0,
    source_errors: 0,
    items_seen: 0,
    items_new: 0,
    pages_fetched: 0,
    pages_fallback: 0,
  };
  const sources = (await opts.store.listSources()).filter((s) => s.active);

  const groups = await Promise.all(
    sources.map(async (source) => {
      try {
        const found = await collectFromSource(source, opts);
        await opts.store.recordSourceResult(source, { ok: true }, opts.now);
        counts.sources_ok++;
        return found;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.log(`  source failed: ${source.name}: ${message}`);
        await opts.store.recordSourceResult(source, { ok: false, error: message.slice(0, 500) }, opts.now);
        counts.source_errors++;
        return [];
      }
    }),
  );

  const all = groups.flat();
  counts.items_seen = all.length;
  const existing = await opts.store.findExistingUrls([...new Set(all.map((c) => c.url))]);
  const seen = new Set<string>(existing);
  const fresh = groups.map((g) =>
    g.filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    }),
  );
  const chosen = roundRobin(fresh, opts.limit ?? Number.POSITIVE_INFINITY);

  const items = await Promise.all(
    chosen.map(async ({ source, entry, url }): Promise<NewRawItem> => {
      let content: string | null = null;
      let ogImage: string | null = entry.image;
      if (source.fetch_mode === "page") {
        const article = await fetchArticle(opts.fetcher, url);
        counts.pages_fetched++;
        if (article.content) content = article.content;
        else counts.pages_fallback++;
        ogImage = article.ogImage ?? ogImage;
      }
      return {
        source_id: source.id,
        url,
        title: entry.title.slice(0, 500),
        summary: entry.summary,
        published_at: entry.publishedAt,
        content,
        og_image: ogImage,
      };
    }),
  );

  const inserted = await opts.store.insertRawItems(items);
  counts.items_new = inserted.length;
  return counts;
}

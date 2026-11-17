import Parser from "rss-parser";

interface MediaNode {
  $?: { url?: string; medium?: string; type?: string };
}

interface CustomItem {
  mediaContent?: MediaNode | MediaNode[];
  mediaThumbnail?: MediaNode | MediaNode[];
}

export interface FeedEntry {
  title: string;
  link: string;
  summary: string | null;
  publishedAt: string | null;
  image: string | null;
}

const parser: Parser<Record<string, unknown>, CustomItem> = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
    ],
  },
});

function firstMediaUrl(node: MediaNode | MediaNode[] | undefined): string | null {
  const list = Array.isArray(node) ? node : node ? [node] : [];
  for (const n of list) {
    const url = n.$?.url;
    const kind = `${n.$?.medium ?? ""} ${n.$?.type ?? ""}`;
    if (url && (kind.trim() === "" || /image/i.test(kind))) return url;
  }
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function parseFeed(xml: string): Promise<FeedEntry[]> {
  const feed = await parser.parseString(xml);
  const entries: FeedEntry[] = [];
  for (const item of feed.items) {
    const link = item.link?.trim();
    const title = item.title?.trim();
    if (!link || !title) continue;
    const rawSummary = item.contentSnippet ?? (item.content ? htmlToText(item.content) : item.summary ?? null);
    const summary = rawSummary ? rawSummary.replace(/\s+/g, " ").trim().slice(0, 2000) : null;
    const date = item.isoDate ?? item.pubDate ?? null;
    const parsed = date ? new Date(date) : null;
    const enclosure = item.enclosure?.url && /image/i.test(item.enclosure.type ?? "image") ? item.enclosure.url : null;
    entries.push({
      title: htmlToText(title),
      link,
      summary: summary || null,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      image: enclosure ?? firstMediaUrl(item.mediaContent) ?? firstMediaUrl(item.mediaThumbnail),
    });
  }
  return entries;
}

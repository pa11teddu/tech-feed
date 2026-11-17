import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceSeed } from "../types";

const dir = join(process.cwd(), "pipeline", "fixtures");
const read = (rel: string) => readFileSync(join(dir, rel), "utf8");

export const FIXTURE_NOW = new Date("2026-11-17T14:00:00Z");

export const FIXTURE_SOURCES: SourceSeed[] = [
  { name: "AI Lab Blog", url: "https://ai.example.com/feed.xml", stream: "ai-ml", fetch_mode: "page", max_items_per_run: 15 },
  { name: "arXiv fixture", url: "https://arxiv.example.org/rss/cs.LG", stream: "ai-ml", fetch_mode: "feed_only", max_items_per_run: 10 },
  { name: "Data Blog", url: "https://data.example.com/atom.xml", stream: "data-eng", fetch_mode: "page", max_items_per_run: 15 },
  { name: "Cloud Status", url: "https://status.example.net/history.rss", stream: "outages", fetch_mode: "feed_only", max_items_per_run: 15 },
  { name: "Crashing source", url: "https://down.example.com/feed.xml", stream: "ai-ml", fetch_mode: "page", max_items_per_run: 15 },
  { name: "Broken XML source", url: "https://broken.example.com/feed.xml", stream: "outages", fetch_mode: "feed_only", max_items_per_run: 15 },
];

const ROBOTS: Record<string, string> = {
  "ai.example.com": "User-agent: *\nDisallow: /private/\n",
};

const ROUTES: Record<string, { status: number; body: string; type?: string }> = {
  "https://ai.example.com/feed.xml": { status: 200, body: read("feeds/ai-blog.xml"), type: "application/rss+xml" },
  "https://arxiv.example.org/rss/cs.LG": { status: 200, body: read("feeds/arxiv.xml"), type: "application/rss+xml" },
  "https://data.example.com/atom.xml": { status: 200, body: read("feeds/data-blog.xml"), type: "application/atom+xml" },
  "https://status.example.net/history.rss": { status: 200, body: read("feeds/status.xml"), type: "application/rss+xml" },
  "https://broken.example.com/feed.xml": { status: 200, body: read("feeds/broken.xml"), type: "application/rss+xml" },
  "https://ai.example.com/posts/reasoning-model": { status: 200, body: read("pages/ai-reasoning-model.html") },
  "https://ai.example.com/posts/distillation": { status: 200, body: read("pages/ai-distillation.html") },
  "https://ai.example.com/posts/agent-benchmark": { status: 200, body: read("pages/ai-agent-benchmark.html") },
  "https://ai.example.com/posts/gpu-supply": { status: 403, body: "Forbidden" },
  "https://data.example.com/blog/exactly-once": { status: 200, body: read("pages/data-exactly-once.html") },
  "https://data.example.com/blog/spilling-joins": { status: 200, body: read("pages/data-spilling-joins.html") },
  "https://data.example.com/blog/webinar": { status: 200, body: read("pages/data-webinar.html") },
  "https://data.example.com/blog/lineage": { status: 200, body: read("pages/data-lineage.html") },
};

export interface MockHttp {
  fetch: typeof fetch;
  requested: string[];
}

/** Mocked HTTP: routes by URL; down.example.com throws like a dead host. */
export function createMockHttp(): MockHttp {
  const requested: string[] = [];
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    const parsed = new URL(url);
    if (parsed.hostname === "down.example.com") throw new TypeError("fetch failed: ECONNREFUSED");
    if (parsed.pathname === "/robots.txt") {
      const robots = ROBOTS[parsed.hostname];
      return robots ? new Response(robots, { status: 200 }) : new Response("not found", { status: 404 });
    }
    const route = ROUTES[url];
    if (!route) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(route.body, {
      status: route.status,
      headers: { "content-type": route.type ?? "text/html; charset=utf-8" },
    });
  };
  return { fetch: impl as typeof fetch, requested };
}

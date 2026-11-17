import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { canonicalizeUrl } from "@/lib/url";
import { RobotsDisallowedError, type Fetcher } from "./fetcher";

export const MAX_CONTENT_CHARS = 12_000;

const PAYWALL_MARKERS = [
  /"isAccessibleForFree"\s*:\s*"?false"?/i,
  /class="[^"]*\bpaywall\b/i,
  /id="[^"]*\bpaywall\b/i,
  /subscribe to (continue|keep) reading/i,
  /this (article|content) is (for|available to) (subscribers|members) only/i,
  /sign in to (continue|read)/i,
];

export interface ArticleResult {
  content: string | null;
  ogImage: string | null;
  /** Why content is null: robots, http status, paywall, not-html, or empty extraction. */
  skipped?: string;
}

export function isPaywalled(html: string): boolean {
  return PAYWALL_MARKERS.some((re) => re.test(html));
}

export function extractOgImage(doc: Document, baseUrl: string): string | null {
  const selectors = [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
  ];
  for (const sel of selectors) {
    const value = doc.querySelector(sel)?.getAttribute("content");
    if (value) {
      const abs = canonicalizeUrl(value, baseUrl);
      if (abs) return abs;
    }
  }
  return null;
}

export function extractArticle(html: string, url: string): ArticleResult {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url, virtualConsole });
  const doc = dom.window.document;
  const ogImage = extractOgImage(doc, url);
  if (isPaywalled(html)) {
    dom.window.close();
    return { content: null, ogImage, skipped: "paywall" };
  }
  const article = new Readability(doc).parse();
  dom.window.close();
  const text = article?.textContent?.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim() ?? "";
  if (text.length < 200) return { content: null, ogImage, skipped: "empty" };
  return { content: text.slice(0, MAX_CONTENT_CHARS), ogImage };
}

/** Fetch a page and extract readable text. Never throws; callers fall back to the RSS summary. */
export async function fetchArticle(fetcher: Fetcher, url: string): Promise<ArticleResult> {
  try {
    const res = await fetcher.get(url);
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      return { content: null, ogImage: null, skipped: `http ${res.status}` };
    }
    if (!res.ok) return { content: null, ogImage: null, skipped: `http ${res.status}` };
    if (!/html/i.test(res.contentType)) return { content: null, ogImage: null, skipped: "not-html" };
    return extractArticle(res.text, res.url);
  } catch (err) {
    return {
      content: null,
      ogImage: null,
      skipped: err instanceof RobotsDisallowedError ? "robots" : "fetch-error",
    };
  }
}

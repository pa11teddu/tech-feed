import pLimit, { type LimitFunction } from "p-limit";
import robotsParser from "robots-parser";

export const USER_AGENT = "TechFeedBot/1.0 (+https://github.com/pa11teddu/tech-feed)";
const MAX_BODY_CHARS = 3_000_000;

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

export interface FetcherOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
  perHost?: number;
  global?: number;
}

interface RobotsRules {
  isAllowed(url: string, ua?: string): boolean | undefined;
}

/**
 * Polite HTTP client: 10s timeout, identifying UA, robots.txt (cached per
 * origin), ≤2 concurrent requests per host and ≤6 globally, in-run URL cache.
 */
export class Fetcher {
  private readonly fetchImpl: typeof fetch;
  private readonly ua: string;
  private readonly timeoutMs: number;
  private readonly perHost: number;
  private readonly globalLimit: LimitFunction;
  private readonly hostLimits = new Map<string, LimitFunction>();
  private readonly robots = new Map<string, Promise<RobotsRules | null>>();
  private readonly cache = new Map<string, Promise<FetchResult>>();

  constructor(opts: FetcherOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.ua = opts.userAgent ?? USER_AGENT;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.perHost = opts.perHost ?? 2;
    this.globalLimit = pLimit(opts.global ?? 6);
  }

  private hostLimit(host: string): LimitFunction {
    let limit = this.hostLimits.get(host);
    if (!limit) {
      limit = pLimit(this.perHost);
      this.hostLimits.set(host, limit);
    }
    return limit;
  }

  /** One retry on transient network errors (connection resets are common on CDNs). */
  private async rawGet(url: string): Promise<FetchResult> {
    try {
      return await this.rawGetOnce(url);
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw err;
      await new Promise((r) => setTimeout(r, 500));
      return this.rawGetOnce(url);
    }
  }

  private async rawGetOnce(url: string): Promise<FetchResult> {
    const host = new URL(url).host;
    return this.hostLimit(host)(() =>
      this.globalLimit(async () => {
        const res = await this.fetchImpl(url, {
          headers: {
            "user-agent": this.ua,
            accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = (await res.text()).slice(0, MAX_BODY_CHARS);
        return {
          ok: res.ok,
          status: res.status,
          url: res.url || url,
          contentType: res.headers.get("content-type") ?? "",
          text,
        };
      }),
    );
  }

  private robotsFor(url: string): Promise<RobotsRules | null> {
    const origin = new URL(url).origin;
    let rules = this.robots.get(origin);
    if (!rules) {
      const robotsUrl = `${origin}/robots.txt`;
      rules = this.rawGet(robotsUrl)
        .then((r) => (r.ok ? (robotsParser(robotsUrl, r.text) as RobotsRules) : null))
        // Missing or unreachable robots.txt means no restrictions.
        .catch(() => null);
      this.robots.set(origin, rules);
    }
    return rules;
  }

  async allowed(url: string): Promise<boolean> {
    const rules = await this.robotsFor(url);
    return rules?.isAllowed(url, this.ua) !== false;
  }

  /** GET with robots check and in-run cache. Throws RobotsDisallowedError or network errors. */
  get(url: string): Promise<FetchResult> {
    let pending = this.cache.get(url);
    if (!pending) {
      pending = (async () => {
        if (!(await this.allowed(url))) throw new RobotsDisallowedError(url);
        return this.rawGet(url);
      })();
      this.cache.set(url, pending);
    }
    return pending;
  }
}

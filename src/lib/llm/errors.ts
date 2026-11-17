/** Thrown when the provider reports an exhausted (daily/monthly) quota. The run ends as `partial`. */
export class LlmQuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmQuotaExhaustedError";
  }
}

/** Thrown when MAX_LLM_CALLS_PER_RUN would be exceeded. */
export class LlmCallBudgetError extends Error {
  constructor(maxCalls: number) {
    super(`MAX_LLM_CALLS_PER_RUN (${maxCalls}) reached`);
    this.name = "LlmCallBudgetError";
  }
}

/** Thrown before a call whose estimated cost would push the run past MAX_RUN_USD. */
export class LlmSpendCapError extends Error {
  constructor(projectedUsd: number, capUsd: number) {
    super(`Estimated spend $${projectedUsd.toFixed(4)} would exceed MAX_RUN_USD $${capUsd.toFixed(2)}`);
    this.name = "LlmSpendCapError";
  }
}

/** Model output failed JSON parsing or schema validation twice. */
export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

/** Non-retryable or retries-exhausted provider failure. */
export class LlmCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmCallError";
  }
}

/** Transport-level error carrying an HTTP-like status for retry decisions. */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  readonly quotaExhausted: boolean;
  constructor(status: number, message: string, opts: { retryAfterMs?: number; quotaExhausted?: boolean } = {}) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
    this.retryAfterMs = opts.retryAfterMs;
    this.quotaExhausted = opts.quotaExhausted ?? false;
  }
}

export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

const QUOTA_PATTERN = /per[\s_-]?day|daily|monthly|weekly|quota exceeded|exceeded your (current )?quota|premium request/i;

export function looksLikeQuotaExhausted(text: string): boolean {
  return QUOTA_PATTERN.test(text);
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Honors retry-after, uses exponential backoff, at most `retries` (3) retries.
 * A 429 that signals an exhausted quota (or 429s that outlast the retries)
 * becomes LlmQuotaExhaustedError so the run can stop gracefully as `partial`.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 60_000;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable =
        err instanceof HttpStatusError
          ? err.status === 429 || err.status >= 500
          : !(err instanceof LlmQuotaExhaustedError || err instanceof LlmCallError);
      if (err instanceof HttpStatusError && err.status === 429 && err.quotaExhausted) {
        throw new LlmQuotaExhaustedError(err.message);
      }
      if (!retryable) {
        if (err instanceof HttpStatusError) throw new LlmCallError(`${err.status}: ${err.message}`);
        throw err;
      }
      if (attempt >= retries) {
        if (err instanceof HttpStatusError && err.status === 429) {
          throw new LlmQuotaExhaustedError(`Rate limited after ${retries} retries: ${err.message}`);
        }
        throw new LlmCallError(err instanceof Error ? err.message : String(err));
      }
      const backoff = Math.min(maxDelay, base * 2 ** attempt);
      const wait = err instanceof HttpStatusError && err.retryAfterMs !== undefined
        ? Math.min(maxDelay, err.retryAfterMs)
        : backoff;
      await sleep(wait);
    }
  }
}

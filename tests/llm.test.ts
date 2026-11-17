import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  extractJson,
  HttpStatusError,
  LlmCallBudgetError,
  LlmCallError,
  LlmClient,
  LlmOutputError,
  LlmQuotaExhaustedError,
  LlmSpendCapError,
  parseRetryAfter,
  withRetry,
  type CompletionRequest,
  type LlmProvider,
  type RawCompletion,
} from "@/lib/llm";
import { parseCopilotJsonl } from "@/lib/llm/copilot";

const schema = z.object({ answer: z.number().int() });

function scripted(replies: (string | Error)[], name: LlmProvider["name"] = "mock") {
  const calls: CompletionRequest[] = [];
  const provider: LlmProvider = {
    name,
    async complete(req): Promise<RawCompletion> {
      calls.push(req);
      const next = replies.shift();
      if (next === undefined) throw new Error("no more replies");
      if (next instanceof Error) throw next;
      return { text: next, tokensIn: 100, tokensOut: 20 };
    },
  };
  return { provider, calls };
}

const client = (provider: LlmProvider, maxCalls = 10, maxRunUsd?: number) =>
  new LlmClient({
    provider,
    models: { classify: "small", write: "claude-sonnet-5-5" },
    maxCalls,
    maxRunUsd,
    retry: { sleep: async () => {} },
  });

describe("extractJson", () => {
  it("handles bare JSON, code fences and surrounding prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Here you go: {"a":3} hope that helps')).toEqual({ a: 3 });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("LlmClient JSON retry", () => {
  it("returns valid output on the first try", async () => {
    const { provider, calls } = scripted(['{"answer": 42}']);
    const r = await client(provider).complete({ role: "classify", system: "s", user: "u", schema });
    expect(r).toEqual({ data: { answer: 42 }, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("small");
  });

  it("retries once with the validation error appended, then succeeds", async () => {
    const { provider, calls } = scripted(['{"answer": "forty-two"}', '{"answer": 42}']);
    const r = await client(provider).complete({ role: "write", system: "s", user: "original prompt", schema });
    expect(r.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.user).toContain("original prompt");
    expect(calls[1]?.user).toContain("Your previous reply was invalid");
    expect(calls[1]?.user).toContain("answer");
  });

  it("retries on unparsable JSON too", async () => {
    const { provider } = scripted(["Sure! {oops", '{"answer": 1}']);
    const r = await client(provider).complete({ role: "classify", system: "s", user: "u", schema });
    expect(r.data.answer).toBe(1);
  });

  it("throws LlmOutputError after the single retry also fails (never a crash)", async () => {
    const { provider, calls } = scripted(["garbage", '{"answer": 1.5}', '{"answer": 3}']);
    await expect(client(provider).complete({ role: "classify", system: "s", user: "u", schema })).rejects.toBeInstanceOf(
      LlmOutputError,
    );
    expect(calls).toHaveLength(2);
  });

  it("counts every attempt against MAX_LLM_CALLS_PER_RUN", async () => {
    const { provider } = scripted(["bad", '{"answer": 1}']);
    const c = client(provider, 1);
    await expect(c.complete({ role: "classify", system: "s", user: "u", schema })).rejects.toBeInstanceOf(
      LlmCallBudgetError,
    );
    expect(c.usage.calls).toBe(1);
  });

  it("tracks usage", async () => {
    const { provider } = scripted(['{"answer": 1}']);
    const c = client(provider);
    await c.complete({ role: "classify", system: "s", user: "u", schema });
    expect(c.usage).toMatchObject({ calls: 1, tokensIn: 100, tokensOut: 20 });
  });

  it("aborts before an Anthropic call that would exceed MAX_RUN_USD", async () => {
    const { provider, calls } = scripted(['{"answer": 1}'], "anthropic");
    const c = client(provider, 10, 0.01);
    await expect(
      c.complete({ role: "write", system: "s", user: "x".repeat(40_000), schema, maxTokens: 3000 }),
    ).rejects.toBeInstanceOf(LlmSpendCapError);
    expect(calls).toHaveLength(0);
  });
});

describe("withRetry (429 handling)", () => {
  it("honors retry-after and succeeds", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const r = await withRetry(
      async () => {
        if (n++ === 0) throw new HttpStatusError(429, "slow down", { retryAfterMs: 7000 });
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(r).toBe("ok");
    expect(sleeps).toEqual([7000]);
  });

  it("uses exponential backoff without retry-after and gives up after 3 retries as quota exhausted", async () => {
    const sleeps: number[] = [];
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpStatusError(429, "rate limited");
        },
        { sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 100 },
      ),
    ).rejects.toBeInstanceOf(LlmQuotaExhaustedError);
    expect(n).toBe(4);
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it("stops immediately on a daily-quota 429", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpStatusError(429, "daily limit", { quotaExhausted: true });
        },
        { sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(LlmQuotaExhaustedError);
    expect(n).toBe(1);
  });

  it("retries 5xx, but not 4xx", async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (n++ < 2) throw new HttpStatusError(503, "busy");
        return 1;
      },
      { sleep: async () => {} },
    );
    expect(r).toBe(1);
    await expect(
      withRetry(async () => {
        throw new HttpStatusError(400, "bad request");
      }),
    ).rejects.toBeInstanceOf(LlmCallError);
  });

  it("parses retry-after seconds and dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter("Tue, 17 Nov 2026 10:00:10 GMT", Date.parse("Tue, 17 Nov 2026 10:00:00 GMT"))).toBe(10_000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe("Copilot CLI output parsing", () => {
  it("extracts the final message, output tokens and premium requests", () => {
    const jsonl = [
      '{"type":"assistant.message_delta","data":{"deltaContent":"{\\"a"}}',
      '{"type":"assistant.message","data":{"content":"{\\"answer\\":1}","outputTokens":53}}',
      '{"type":"session.usage_checkpoint","data":{"totalPremiumRequests":0.33}}',
      '{"type":"result","exitCode":0,"usage":{"premiumRequests":0.33}}',
    ].join("\n");
    expect(parseCopilotJsonl(jsonl)).toEqual({ text: '{"answer":1}', tokensOut: 53, premiumRequests: 0.33, error: undefined });
  });
});

import type { z } from "zod";
import type { LlmProviderName } from "./env";
import { LlmCallBudgetError, LlmOutputError, LlmSpendCapError, withRetry, type RetryOptions } from "./llm/errors";
import { anthropicCostUsd, copilotCostUsd, estimateTokens } from "./pricing";

export * from "./llm/errors";

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface RawCompletion {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** Copilot only: premium requests consumed by this call. */
  premiumRequests?: number;
}

/** A provider performs exactly one model call per `complete`. */
export interface LlmProvider {
  readonly name: LlmProviderName | "mock";
  complete(req: CompletionRequest): Promise<RawCompletion>;
}

export type ModelRole = "classify" | "write";

export interface LlmUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  premiumRequests: number;
  estCostUsd: number;
}

export interface LlmClientOptions {
  provider: LlmProvider;
  models: Record<ModelRole, string>;
  maxCalls: number;
  /** Only enforced for Anthropic (PLAN §6). */
  maxRunUsd?: number;
  retry?: RetryOptions;
}

export interface CompleteArgs<T> {
  role: ModelRole;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface CompleteResult<T> {
  data: T;
  attempts: number;
}

/** Pull a JSON object out of a reply that may include code fences or prose. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found in reply");
  return JSON.parse(candidate.slice(start, end + 1));
}

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as z.ZodError).issues)) {
    return (err as z.ZodError).issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

export class LlmClient {
  readonly usage: LlmUsage = { calls: 0, tokensIn: 0, tokensOut: 0, premiumRequests: 0, estCostUsd: 0 };
  constructor(private readonly opts: LlmClientOptions) {}

  get providerName(): string {
    return this.opts.provider.name;
  }

  modelFor(role: ModelRole): string {
    return this.opts.models[role];
  }

  remainingCalls(): number {
    return Math.max(0, this.opts.maxCalls - this.usage.calls);
  }

  private costOf(model: string, raw: RawCompletion): number {
    if (this.opts.provider.name === "anthropic") return anthropicCostUsd(model, raw.tokensIn, raw.tokensOut);
    if (this.opts.provider.name === "copilot") return copilotCostUsd(raw.premiumRequests ?? 0);
    return 0;
  }

  private checkBudget(req: CompletionRequest): void {
    if (this.usage.calls >= this.opts.maxCalls) throw new LlmCallBudgetError(this.opts.maxCalls);
    const cap = this.opts.maxRunUsd;
    if (this.opts.provider.name === "anthropic" && cap !== undefined) {
      const projected =
        this.usage.estCostUsd +
        anthropicCostUsd(req.model, estimateTokens(req.system.length + req.user.length), req.maxTokens);
      if (projected > cap) throw new LlmSpendCapError(projected, cap);
    }
  }

  private async call(req: CompletionRequest): Promise<RawCompletion> {
    this.checkBudget(req);
    this.usage.calls += 1;
    const raw = await withRetry(() => this.opts.provider.complete(req), this.opts.retry);
    this.usage.tokensIn += raw.tokensIn;
    this.usage.tokensOut += raw.tokensOut;
    this.usage.premiumRequests += raw.premiumRequests ?? 0;
    this.usage.estCostUsd += this.costOf(req.model, raw);
    return raw;
  }

  /**
   * JSON-only completion validated with zod. On parse/validation failure it
   * retries once with the error appended, then throws LlmOutputError.
   */
  async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
    const model = this.modelFor(args.role);
    const maxTokens = args.maxTokens ?? (args.role === "write" ? 3000 : 1500);
    let user = args.user;
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await this.call({ model, system: args.system, user, maxTokens });
      try {
        const data = args.schema.parse(extractJson(raw.text));
        return { data, attempts: attempt };
      } catch (err) {
        lastError = describeError(err);
        user =
          `${args.user}\n\nYour previous reply was invalid: ${lastError}\n` +
          `Reply again with ONLY one corrected JSON object that satisfies every rule.`;
      }
    }
    throw new LlmOutputError(`invalid model output after retry: ${lastError}`);
  }
}

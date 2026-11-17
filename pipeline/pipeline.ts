import {
  LlmCallBudgetError,
  LlmQuotaExhaustedError,
  LlmSpendCapError,
  type LlmClient,
  type LlmUsage,
} from "@/lib/llm";
import type { PostRow } from "@/lib/schema";
import { classify } from "./classify";
import { dedupe } from "./dedupe";
import type { Fetcher } from "./fetcher";
import { generate } from "./generate";
import { ingest } from "./ingest";
import { retention } from "./retention";
import { select } from "./select";
import type { RunRecord, RunStatus, Store } from "./types";

export const STEPS = ["ingest", "dedupe", "classify", "select", "generate", "retention"] as const;
export type StepName = (typeof STEPS)[number];
const LLM_STEPS: readonly StepName[] = ["classify", "generate"];

export interface PipelineConfig {
  maxPerStream: number;
  minImportance: number;
  maxInputChars: number;
}

export interface PipelineDeps {
  store: Store;
  llm: LlmClient;
  fetcher: Fetcher;
  config: PipelineConfig;
  now: () => Date;
  log: (msg: string) => void;
  limit?: number;
  steps?: readonly StepName[];
}

export interface RunResult {
  status: Exclude<RunStatus, "running">;
  counts: Record<string, number>;
  error: string | null;
  usage: LlmUsage;
  posts: PostRow[];
}

/** Quota, call-cap and spend-cap errors stop the LLM steps; the run ends `partial`. */
function isLlmStop(err: unknown): err is Error {
  return (
    err instanceof LlmQuotaExhaustedError || err instanceof LlmCallBudgetError || err instanceof LlmSpendCapError
  );
}

export async function runPipeline(deps: PipelineDeps): Promise<RunResult> {
  const steps = deps.steps ?? STEPS;
  const counts: Record<string, number> = {};
  const posts: PostRow[] = [];
  let status: RunResult["status"] = "ok";
  let error: string | null = null;
  let llmStopped = false;

  for (const step of steps) {
    if (llmStopped && LLM_STEPS.includes(step)) {
      deps.log(`- ${step}: skipped (LLM stopped)`);
      continue;
    }
    deps.log(`- ${step}`);
    try {
      let result: object;
      switch (step) {
        case "ingest":
          result = await ingest({ store: deps.store, fetcher: deps.fetcher, now: deps.now(), limit: deps.limit, log: deps.log });
          break;
        case "dedupe":
          result = await dedupe(deps.store);
          break;
        case "classify":
          result = await classify(deps.store, deps.llm, deps.config.minImportance, deps.log);
          break;
        case "select":
          result = await select(deps.store, deps.config.maxPerStream, deps.now());
          break;
        case "generate":
          result = await generate(deps.store, deps.llm, deps.config.maxInputChars, deps.now(), deps.log, (p) =>
            posts.push(p),
          );
          break;
        case "retention":
          result = await retention(deps.store, deps.now());
          break;
      }
      Object.assign(counts, result);
    } catch (err) {
      if (isLlmStop(err)) {
        llmStopped = true;
        status = "partial";
        error = err.message;
        deps.log(`  LLM stopped: ${err.message}. Stories keep their status for the next run.`);
        continue;
      }
      status = "failed";
      error = `${step}: ${err instanceof Error ? err.message : String(err)}`;
      deps.log(`  step failed: ${error}`);
      break;
    }
  }
  counts.posts_generated = posts.length;
  return { status, counts, error, usage: { ...deps.llm.usage }, posts };
}

export function toRunRecord(result: RunResult): RunRecord {
  return {
    status: result.status,
    counts: { ...result.counts, premium_requests: result.usage.premiumRequests },
    llm_calls: result.usage.calls,
    tokens_in: result.usage.tokensIn,
    tokens_out: result.usage.tokensOut,
    est_cost_usd: Number(result.usage.estCostUsd.toFixed(4)),
    error: result.error,
  };
}

export function formatSummary(result: RunResult, provider: string): string {
  const rows: [string, string][] = [
    ["status", result.status],
    ["provider", provider],
    ...Object.entries(result.counts).map(([k, v]): [string, string] => [k, String(v)]),
    ["llm_calls", String(result.usage.calls)],
    ["tokens_in", String(result.usage.tokensIn)],
    ["tokens_out", String(result.usage.tokensOut)],
    ["premium_requests", result.usage.premiumRequests.toFixed(2)],
    ["est_cost_usd", result.usage.estCostUsd.toFixed(4)],
  ];
  if (result.error) rows.push(["error", result.error]);
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${k.padEnd(width)} | ${v}`).join("\n");
}

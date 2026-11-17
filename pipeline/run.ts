import { parseArgs } from "node:util";
import { createServiceSupabase } from "@/lib/db";
import { EnvError, loadPipelineEnv } from "@/lib/env";
import { createLlmClient } from "@/lib/llm/factory";
import type { PostRow } from "@/lib/schema";
import { countWords } from "@/lib/schema";
import { PHASE1_STREAMS, streamLabel } from "@/lib/streams";
import { Fetcher } from "./fetcher";
import { loadLocalEnv } from "./load-env";
import { formatSummary, runPipeline, STEPS, toRunRecord, type StepName } from "./pipeline";
import { PHASE1_SOURCES } from "./sources.seed";
import { MemoryStore } from "./store-memory";
import { SupabaseStore } from "./store-supabase";
import type { Store } from "./types";

export const SKIP_IF_OK_WITHIN_HOURS = 6;

function printPost(post: PostRow, index: number): void {
  console.log(`\n━━━ Post ${index + 1} · ${streamLabel(post.stream)} · importance ${post.importance} ━━━`);
  console.log(`# ${post.headline}`);
  console.log(`TL;DR: ${post.tldr}`);
  console.log(`Image: ${post.image_url ?? "(none, gradient fallback)"}`);
  console.log(`Body (${countWords(post.body_md)} words):\n${post.body_md}`);
  console.log(`Takeaways:\n${post.takeaways.map((t) => `  • ${t}`).join("\n")}`);
  console.log(`Links:\n${post.links.map((l) => `  - ${l.title} <${l.url}>`).join("\n")}`);
}

async function main(): Promise<number> {
  loadLocalEnv();
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      limit: { type: "string" },
      step: { type: "string" },
      force: { type: "boolean", default: false },
    },
  });
  const dryRun = values["dry-run"] ?? false;
  const limit = values.limit !== undefined ? Number.parseInt(values.limit, 10) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
  const step = values.step;
  if (step !== undefined && !(STEPS as readonly string[]).includes(step)) {
    throw new Error(`--step must be one of: ${STEPS.join(", ")}`);
  }
  const steps: readonly StepName[] = step ? [step as StepName] : STEPS;
  const needsLlm = steps.includes("classify") || steps.includes("generate");

  const env = loadPipelineEnv({ db: !dryRun, llm: needsLlm });
  const store: Store = dryRun
    ? new MemoryStore(PHASE1_SOURCES)
    : new SupabaseStore(createServiceSupabase(env.SUPABASE_URL ?? "", env.SUPABASE_SERVICE_ROLE_KEY ?? ""));
  const llm = createLlmClient(env);
  const now = () => new Date();

  console.log(
    `tech-feed pipeline · ${dryRun ? "DRY RUN (no DB)" : "live"} · provider=${env.LLM_PROVIDER} ` +
      `classify=${env.MODEL_CLASSIFY} write=${env.MODEL_WRITE} · steps=${steps.join(",")}` +
      (limit ? ` · limit=${limit}` : ""),
  );
  if (dryRun) console.log(`Dry-run sources: ${PHASE1_SOURCES.length} Phase 1 sources (${PHASE1_STREAMS.join(", ")})`);

  if (!dryRun && !values.force) {
    const last = await store.lastOkRunFinishedAt();
    if (last && now().getTime() - last.getTime() < SKIP_IF_OK_WITHIN_HOURS * 3_600_000) {
      const id = await store.startRun(env.LLM_PROVIDER, now());
      await store.finishRun(
        id,
        { status: "skipped", counts: {}, llm_calls: 0, tokens_in: 0, tokens_out: 0, est_cost_usd: 0, error: null },
        now(),
      );
      console.log(`Skipped: an ok run finished at ${last.toISOString()} (< ${SKIP_IF_OK_WITHIN_HOURS}h ago). Use --force.`);
      return 0;
    }
  }

  const runId = await store.startRun(env.LLM_PROVIDER, now());
  const result = await runPipeline({
    store,
    llm,
    fetcher: new Fetcher(),
    config: {
      maxPerStream: env.MAX_PER_STREAM_PER_RUN,
      minImportance: env.MIN_IMPORTANCE,
      maxInputChars: env.MAX_INPUT_CHARS,
    },
    now,
    log: (m) => console.log(m),
    limit,
    steps,
  });
  await store.finishRun(runId, toRunRecord(result), now());

  if (dryRun) {
    console.log(`\nGenerated ${result.posts.length} post(s):`);
    result.posts.forEach(printPost);
  }
  console.log(`\nRun summary\n${formatSummary(result, env.LLM_PROVIDER)}`);

  if (result.status === "failed") return 1;
  if (env.LLM_PROVIDER === "anthropic" && result.usage.estCostUsd > env.MAX_RUN_USD) {
    console.error(`Anthropic spend $${result.usage.estCostUsd.toFixed(4)} exceeded MAX_RUN_USD $${env.MAX_RUN_USD}`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof EnvError ? err.message : err);
    process.exit(1);
  },
);

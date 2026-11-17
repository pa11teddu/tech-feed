import { LlmCallError, LlmOutputError, type LlmClient } from "@/lib/llm";
import { buildClassifyPrompt, CLASSIFY_SYSTEM, type ClassifyInput } from "@/lib/prompts";
import { classifyResponseSchema } from "@/lib/schema";
import type { Store, StoryWithItems } from "./types";

export const CLASSIFY_BATCH_SIZE = 15;
export const SNIPPET_CHARS = 500;
export const MAX_ATTEMPTS = 3;

export interface ClassifyCounts {
  classified: number;
  rejected: number;
  classify_failed: number;
}

export function storySnippet(story: StoryWithItems): { title: string; snippet: string } {
  const item = story.items[0];
  const text = item?.content ?? item?.summary ?? "";
  return { title: item?.title ?? "(untitled)", snippet: text.replace(/\s+/g, " ").slice(0, SNIPPET_CHARS) };
}

/**
 * Failure policy shared by classify and generate: attempts++ and the story
 * stays retryable in its current status; after MAX_ATTEMPTS it becomes
 * `failed` and is never retried.
 */
export async function recordFailure(store: Store, story: StoryWithItems): Promise<boolean> {
  const attempts = story.attempts + 1;
  const failed = attempts >= MAX_ATTEMPTS;
  await store.updateStory(story.id, failed ? { attempts, status: "failed" } : { attempts });
  return failed;
}

export async function classify(
  store: Store,
  llm: LlmClient,
  minImportance: number,
  log: (msg: string) => void,
): Promise<ClassifyCounts> {
  const counts: ClassifyCounts = { classified: 0, rejected: 0, classify_failed: 0 };
  const stories = (await store.storiesWithStatus("new", 300)).filter((s) => s.items.length > 0);

  for (let i = 0; i < stories.length; i += CLASSIFY_BATCH_SIZE) {
    const batch = stories.slice(i, i + CLASSIFY_BATCH_SIZE);
    const inputs: ClassifyInput[] = batch.map((s) => ({
      id: s.id,
      ...storySnippet(s),
      streamHint: s.stream ?? "unknown",
    }));
    let results;
    try {
      ({ data: results } = await llm.complete({
        role: "classify",
        system: CLASSIFY_SYSTEM,
        user: buildClassifyPrompt(inputs),
        schema: classifyResponseSchema,
      }));
    } catch (err) {
      if (!(err instanceof LlmOutputError || err instanceof LlmCallError)) throw err;
      log(`  classify batch failed: ${err.message}`);
      for (const s of batch) if (await recordFailure(store, s)) counts.classify_failed++;
      continue;
    }

    const byId = new Map(results.results.map((r) => [r.id, r]));
    for (const story of batch) {
      const r = byId.get(story.id);
      if (!r) {
        if (await recordFailure(store, story)) counts.classify_failed++;
        continue;
      }
      const rejected = r.is_noise || r.importance < minImportance;
      await store.updateStory(story.id, {
        stream: r.stream,
        importance: r.importance,
        status: rejected ? "rejected" : "classified",
      });
      if (rejected) counts.rejected++;
      else counts.classified++;
    }
  }
  return counts;
}

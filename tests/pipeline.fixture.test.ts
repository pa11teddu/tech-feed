import { beforeEach, describe, expect, it } from "vitest";
import { HttpStatusError, LlmClient, type LlmProvider } from "@/lib/llm";
import { generatedPostSchema } from "@/lib/schema";
import { createMockHttp, FIXTURE_NOW, FIXTURE_SOURCES } from "../pipeline/fixtures/http";
import { MockLlmProvider } from "../pipeline/fixtures/mock-llm";
import { Fetcher } from "../pipeline/fetcher";
import { runPipeline, type PipelineDeps } from "../pipeline/pipeline";
import { MemoryStore } from "../pipeline/store-memory";

const config = { maxPerStream: 3, minImportance: 5, maxInputChars: 18_000 };

function deps(store: MemoryStore, provider: LlmProvider, now = FIXTURE_NOW): PipelineDeps {
  return {
    store,
    llm: new LlmClient({
      provider,
      models: { classify: "mock-small", write: "mock-large" },
      maxCalls: 40,
      retry: { sleep: async () => {} },
    }),
    fetcher: new Fetcher({ fetchImpl: createMockHttp().fetch }),
    config,
    now: () => now,
    log: () => {},
  };
}

describe("pipeline fixture run (mocked LLM + mocked HTTP)", () => {
  let store: MemoryStore;
  let llm: MockLlmProvider;

  beforeEach(() => {
    store = new MemoryStore(FIXTURE_SOURCES, () => FIXTURE_NOW);
    llm = new MockLlmProvider();
  });

  it("produces ≥10 valid posts across runs; bad sources and malformed output don't fail the run", async () => {
    const run1 = await runPipeline(deps(store, llm));

    // A crashing source (network error) and a malformed feed are recorded, not fatal.
    expect(run1.status).toBe("ok");
    expect(run1.counts.source_errors).toBe(2);
    expect(run1.counts.sources_ok).toBe(4);
    const crashed = store.sources.find((s) => s.name === "Crashing source");
    expect(crashed?.consecutive_failures).toBe(1);
    expect(crashed?.last_error).toMatch(/fetch failed/);

    // 15 fresh items (one >48h item dropped), each its own story in Phase 1.
    expect(run1.counts.items_new).toBe(15);
    expect(store.items.some((i) => i.url.endsWith("/posts/stale"))).toBe(false);
    expect(store.stories).toHaveLength(15);
    // The first classify reply was malformed; the retry recovered the whole batch.
    expect(run1.counts.classified).toBe(14);
    expect(run1.counts.rejected).toBe(1);
    // Per-stream cap of 3 → 9 selected; the malformed-output story failed generation.
    expect(run1.counts.selected).toBe(9);
    expect(run1.counts.generate_retry_later).toBe(1);
    expect(run1.posts).toHaveLength(8);

    const run2 = await runPipeline(deps(store, llm));
    expect(run2.status).toBe("ok");
    expect(run2.counts.items_new).toBe(0);
    expect(store.posts.length).toBeGreaterThanOrEqual(10);

    // Every post is schema-valid, uses only input URLs, and has an image or the gradient fallback.
    const inputUrls = new Set(store.items.map((i) => i.url));
    for (const post of store.posts) {
      expect(generatedPostSchema.safeParse(post).success).toBe(true);
      expect(post.links.length).toBeGreaterThan(0);
      for (const link of post.links) expect(inputUrls.has(link.url)).toBe(true);
      expect(post.links.some((l) => l.url.includes("evil.example.com"))).toBe(false);
    }
    expect(run1.counts.links_dropped).toBeGreaterThan(0);
    expect(new Set(store.posts.map((p) => p.story_id)).size).toBe(store.posts.length);

    // A third run exhausts attempts: the malformed story becomes `failed` and is never retried.
    await runPipeline(deps(store, llm));
    const bad = store.stories.find((s) =>
      store.items.some((i) => i.story_id === s.id && i.title.startsWith("Malformed output trigger")),
    );
    expect(bad?.status).toBe("failed");
    expect(bad?.attempts).toBe(3);
    const callsBefore = llm.calls.length;
    await runPipeline(deps(store, llm));
    expect(llm.calls.filter((c) => c.user.includes("Malformed output trigger")).length).toBe(
      (llm.calls.slice(0, callsBefore).filter((c) => c.user.includes("Malformed output trigger")).length),
    );
  });

  it("falls back to the RSS summary for 403, robots-blocked, and feed_only items; picks og:image", async () => {
    await runPipeline(deps(store, llm));
    const byPath = (p: string) => store.items.find((i) => i.url.endsWith(p));
    expect(byPath("/posts/gpu-supply")?.content).toBeNull();
    expect(byPath("/posts/gpu-supply")?.summary).toMatch(/403/);
    expect(byPath("/private/tokenizers")?.content).toBeNull();
    expect(byPath("/posts/reasoning-model")?.content?.length).toBeGreaterThan(500);
    expect(byPath("/posts/reasoning-model")?.content?.length).toBeLessThanOrEqual(12_000);
    expect(byPath("/posts/reasoning-model")?.og_image).toBe("https://ai.example.com/images/reasoning-model.jpg");
    expect(byPath("/abs/2611.00001")?.content).toBeNull();
    // utm params are canonicalized away.
    expect(byPath("/posts/reasoning-model")?.url).toBe("https://ai.example.com/posts/reasoning-model");
    // Logo og:images are not used as post images.
    const dataPosts = store.posts.filter((p) => p.stream === "data-eng");
    expect(dataPosts.length).toBeGreaterThan(0);
    for (const p of dataPosts) expect(p.image_url).toBeNull();
  });

  it("ends `partial` (not `failed`) when the LLM quota runs out, leaving stories for the next run", async () => {
    let n = 0;
    const quotaAfterClassify: LlmProvider = {
      name: "mock",
      async complete(req) {
        if (++n > 2) throw new HttpStatusError(429, "daily quota exceeded", { quotaExhausted: true });
        return llm.complete(req);
      },
    };
    const run = await runPipeline(deps(store, quotaAfterClassify));
    expect(run.status).toBe("partial");
    expect(run.error).toMatch(/quota/);
    expect(run.posts).toHaveLength(0);
    expect(store.stories.filter((s) => s.status === "selected")).toHaveLength(9);
    expect(run.counts.content_cleared).toBe(0); // retention still ran
  });

  it("respects MAX_LLM_CALLS_PER_RUN as a hard cap", async () => {
    const d = deps(store, llm);
    d.llm = new LlmClient({
      provider: llm,
      models: { classify: "a", write: "b" },
      maxCalls: 4,
      retry: { sleep: async () => {} },
    });
    const run = await runPipeline(d);
    expect(run.status).toBe("partial");
    expect(run.usage.calls).toBe(4);
  });

  it("dry-run style --limit samples across sources", async () => {
    const d = { ...deps(store, llm), limit: 4 };
    const run = await runPipeline(d);
    expect(run.counts.items_new).toBe(4);
    const streams = new Set(store.stories.map((s) => s.stream));
    expect(streams.size).toBeGreaterThanOrEqual(3);
  });
});

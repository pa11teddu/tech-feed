import type { PostRow } from "./schema";

const H = 3_600_000;

function body(topic: string, paragraphs: readonly [string, string, string]): string {
  return [`## What happened`, paragraphs[0], `## Why it matters`, paragraphs[1], `## Caveats`, paragraphs[2]]
    .map((p) => p.replaceAll("{topic}", topic))
    .join("\n\n");
}

const FILLER: readonly [string, string, string] = [
  "The announcement describes {topic} in enough detail to judge the claims, but several numbers come from the vendor's own benchmarks rather than independent tests. The core idea is to move expensive work out of the critical path and make the common case cheaper, which is a pattern engineers will recognize from caching, batching, and speculative execution. Early adopters report that the change is mostly invisible to application code, which is the point: the improvement lands below the API surface where most teams never have to touch it. The release notes list the supported environments, the migration steps, and a short list of known limitations that are worth reading before upgrading production systems.",
  "For teams running {topic} at scale, the practical effect is lower tail latency and fewer surprise bills, at the cost of a slightly more complex operational model. It also signals where the ecosystem is heading: defaults that used to require careful tuning are becoming automatic, and the remaining knobs are about trade-offs rather than correctness. That shifts the skill set from configuring systems to observing them. If you own dashboards or runbooks, expect some metrics to change meaning, and plan a short review so alerts keep firing for the right reasons. Smaller teams can mostly wait for the defaults to settle before acting.",
  "The sources do not say how {topic} behaves under adversarial or unusual workloads, and the comparison baselines are not fully specified. Some details may change before general availability, so treat specific figures as provisional. It is also unclear how much of the gain carries over to smaller deployments, where fixed overheads dominate. A careful rollout with a canary, a rollback plan, and a before-and-after measurement of your own traffic remains the safest path. Independent reproductions, if they appear, will be the best signal of whether the headline results hold up outside the vendor's lab.",
];

function post(
  id: string,
  stream: string,
  headline: string,
  tldr: string,
  topic: string,
  importance: number,
  ageHours: number,
  imageUrl: string | null,
  links: { title: string; url: string }[],
): PostRow {
  return {
    id,
    story_id: null,
    stream,
    headline,
    tldr,
    body_md: body(topic, FILLER),
    takeaways: [
      `Check whether ${topic} changes your defaults before upgrading.`,
      "Vendor benchmarks are promising but not yet independently reproduced.",
      "Roll out behind a canary and measure your own traffic.",
    ],
    links,
    image_url: imageUrl,
    diagram_svg: null,
    importance,
    boost: 0,
    published_at: new Date(Date.UTC(2026, 10, 17, 14, 0) - ageHours * H).toISOString(),
  };
}

/** Dev-only fixtures for UI previews and screenshots (MOCK_DATA=1, never in production). */
export const MOCK_POSTS: PostRow[] = [
  post(
    "00000000-0000-4000-8000-000000000001",
    "ai-ml",
    "Open-weight model matches frontier reasoning scores at a tenth of the inference cost",
    "A new open-weight model reports reasoning benchmark results close to closed frontier models while running on a single node. The gains come mostly from distillation and a sparser attention layout.",
    "the new open-weight model",
    9,
    2,
    null,
    [{ title: "Model card and evaluation report", url: "https://example.com/ai/model-card" }],
  ),
  post(
    "00000000-0000-4000-8000-000000000002",
    "outages",
    "Regional DNS failure took down a major cloud's control plane for 47 minutes",
    "A misapplied DNS configuration in one region broke API calls and console access while running workloads stayed up. The provider has paused similar changes pending review.",
    "the DNS control-plane change",
    8,
    5,
    null,
    [
      { title: "Provider status page incident", url: "https://example.com/status/incident-1" },
      { title: "Preliminary post-incident review", url: "https://example.com/status/pir" },
    ],
  ),
  post(
    "00000000-0000-4000-8000-000000000003",
    "data-eng",
    "Streaming engine adds exactly-once sinks for open table formats",
    "The latest release can commit streaming writes to Iceberg and Delta tables transactionally. That removes a common source of duplicate rows in lakehouse pipelines.",
    "exactly-once table sinks",
    7,
    9,
    null,
    [{ title: "Release announcement", url: "https://example.com/data/release" }],
  ),
  post(
    "00000000-0000-4000-8000-000000000004",
    "ai-ml",
    "Paper: small models learn to verify their own chain-of-thought",
    "Researchers train a compact verifier that scores intermediate reasoning steps, improving accuracy on math benchmarks without a larger base model.",
    "step-level verification",
    6,
    14,
    null,
    [{ title: "arXiv preprint", url: "https://example.com/arxiv/2611.00001" }],
  ),
  post(
    "00000000-0000-4000-8000-000000000005",
    "data-eng",
    "Columnar engine ships vectorized joins that spill gracefully to disk",
    "Large joins no longer fail when memory runs out. The engine now spills partitions to disk and keeps most of its in-memory speed.",
    "spilling vectorized joins",
    6,
    20,
    null,
    [{ title: "Engineering blog post", url: "https://example.com/data/joins" }],
  ),
];

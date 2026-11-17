import { LlmCallError, LlmOutputError, type LlmClient } from "@/lib/llm";
import { validateLinks } from "@/lib/links";
import { buildWritePrompt, WRITE_SYSTEM, type WriteSource } from "@/lib/prompts";
import { generatedPostSchema, type PostRow } from "@/lib/schema";
import { streamLabel } from "@/lib/streams";
import { recordFailure } from "./classify";
import { pickImage } from "./image";
import type { Store, StoryWithItems } from "./types";

export interface GenerateCounts {
  generated: number;
  generate_failed: number;
  generate_retry_later: number;
  links_dropped: number;
  rejected_no_links: number;
}

/** Split MAX_INPUT_CHARS evenly across the story's items. */
export function buildSources(story: StoryWithItems, maxInputChars: number): WriteSource[] {
  const per = Math.floor(maxInputChars / Math.max(1, story.items.length));
  return story.items.map((item) => ({
    url: item.url,
    title: item.title,
    text: (item.content ?? item.summary ?? item.title).slice(0, per),
  }));
}

export async function generate(
  store: Store,
  llm: LlmClient,
  maxInputChars: number,
  now: Date,
  log: (msg: string) => void,
  onPost?: (post: PostRow) => void,
): Promise<GenerateCounts> {
  const counts: GenerateCounts = {
    generated: 0,
    generate_failed: 0,
    generate_retry_later: 0,
    links_dropped: 0,
    rejected_no_links: 0,
  };
  const stories = await store.storiesWithStatus("selected", 100);

  for (const story of stories) {
    if (story.items.length === 0 || !story.stream) continue;
    let data;
    try {
      ({ data } = await llm.complete({
        role: "write",
        system: WRITE_SYSTEM,
        user: buildWritePrompt(streamLabel(story.stream), buildSources(story, maxInputChars)),
        schema: generatedPostSchema,
      }));
    } catch (err) {
      if (!(err instanceof LlmOutputError || err instanceof LlmCallError)) throw err;
      log(`  generate failed for story ${story.id}: ${err.message.slice(0, 200)}`);
      if (await recordFailure(store, story)) counts.generate_failed++;
      else counts.generate_retry_later++;
      continue;
    }

    const { kept, dropped } = validateLinks(data.links, story.items.map((i) => i.url));
    counts.links_dropped += dropped.length;
    if (kept.length === 0) {
      counts.rejected_no_links++;
      await store.updateStory(story.id, { status: "rejected" });
      continue;
    }

    const post = await store.insertPost(
      {
        story_id: story.id,
        stream: story.stream,
        headline: data.headline,
        tldr: data.tldr,
        body_md: data.body_md,
        takeaways: data.takeaways,
        links: kept,
        image_url: pickImage(story.items.map((i) => i.og_image)),
        importance: story.importance ?? 5,
      },
      now,
    );
    await store.updateStory(story.id, { status: "generated" });
    counts.generated++;
    onPost?.(post);
  }
  return counts;
}

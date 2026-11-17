import type { Store, StoryWithItems } from "./types";

export const LEFTOVER_TTL_DAYS = 3;

export interface SelectCounts {
  selected: number;
  expired: number;
}

function recency(story: StoryWithItems): string {
  const dates = story.items.map((i) => i.published_at ?? i.fetched_at);
  return dates.sort().at(-1) ?? story.created_at;
}

/** Per stream: top N classified stories by importance, then recency. */
export function pickTop(stories: readonly StoryWithItems[], perStream: number): StoryWithItems[] {
  const byStream = new Map<string, StoryWithItems[]>();
  for (const s of stories) {
    const key = s.stream ?? "unknown";
    byStream.set(key, [...(byStream.get(key) ?? []), s]);
  }
  const picked: StoryWithItems[] = [];
  for (const group of byStream.values()) {
    group.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || recency(b).localeCompare(recency(a)));
    picked.push(...group.slice(0, perStream));
  }
  return picked;
}

export async function select(store: Store, perStream: number, now: Date): Promise<SelectCounts> {
  const cutoff = new Date(now.getTime() - LEFTOVER_TTL_DAYS * 86_400_000);
  const expired = await store.expireClassified(cutoff);
  const classified = await store.storiesWithStatus("classified", 1000);
  const picked = pickTop(classified, perStream);
  for (const s of picked) await store.updateStory(s.id, { status: "selected" });
  return { selected: picked.length, expired };
}

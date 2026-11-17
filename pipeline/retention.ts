import type { Store } from "./types";

export interface RetentionCounts {
  content_cleared: number;
  stories_deleted: number;
}

/** Null raw_items.content after 14 days; delete rejected/failed stories after 30 days. */
export async function retention(store: Store, now: Date): Promise<RetentionCounts> {
  const r = await store.retention(now);
  return { content_cleared: r.contentCleared, stories_deleted: r.storiesDeleted };
}

export const CONTENT_TTL_DAYS = 14;
export const DEAD_STORY_TTL_DAYS = 30;

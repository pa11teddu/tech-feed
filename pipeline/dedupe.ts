import type { Source, Store } from "./types";

export interface DedupeCounts {
  stories_created: number;
}

/**
 * Phase 1: every unassigned raw item becomes its own story, with the source's
 * stream as a hint. Phase 2 replaces this with embedding-based clustering.
 */
export async function dedupe(store: Store): Promise<DedupeCounts> {
  const sources = new Map<string, Source>((await store.listSources()).map((s) => [s.id, s]));
  const items = await store.unassignedItems();
  for (const item of items) {
    const hint = item.source_id ? (sources.get(item.source_id)?.stream ?? null) : null;
    await store.createStoryForItem(item, hint);
  }
  return { stories_created: items.length };
}

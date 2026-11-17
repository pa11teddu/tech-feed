import type { PostLink, PostRow } from "@/lib/schema";
import type { StreamId } from "@/lib/streams";

export type FetchMode = "page" | "feed_only";

export interface SourceSeed {
  name: string;
  url: string;
  stream: StreamId;
  fetch_mode: FetchMode;
  max_items_per_run: number;
}

export interface Source extends SourceSeed {
  id: string;
  active: boolean;
  consecutive_failures: number;
}

export interface NewRawItem {
  source_id: string | null;
  url: string;
  title: string;
  summary: string | null;
  published_at: string | null;
  content: string | null;
  og_image: string | null;
}

export interface RawItem extends NewRawItem {
  id: string;
  story_id: string | null;
  fetched_at: string;
}

export const STORY_STATUSES = ["new", "classified", "rejected", "selected", "generated", "failed"] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export interface Story {
  id: string;
  stream: string | null;
  importance: number | null;
  status: StoryStatus;
  attempts: number;
  created_at: string;
}

export interface StoryWithItems extends Story {
  items: RawItem[];
}

export type StoryPatch = Partial<Pick<Story, "stream" | "importance" | "status" | "attempts">>;

export interface NewPost {
  story_id: string;
  stream: string;
  headline: string;
  tldr: string;
  body_md: string;
  takeaways: string[];
  links: PostLink[];
  image_url: string | null;
  importance: number;
}

export type RunStatus = "running" | "ok" | "partial" | "failed" | "skipped";

export interface RunRecord {
  status: RunStatus;
  counts: Record<string, number>;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  est_cost_usd: number;
  error: string | null;
}

export type SourceResult = { ok: true } | { ok: false; error: string };

/** Persistence used by every pipeline step. Supabase in production, memory for dry-runs/tests. */
export interface Store {
  listSources(): Promise<Source[]>;
  recordSourceResult(source: Source, result: SourceResult, now: Date): Promise<void>;
  findExistingUrls(urls: string[]): Promise<Set<string>>;
  insertRawItems(items: NewRawItem[]): Promise<RawItem[]>;
  unassignedItems(): Promise<RawItem[]>;
  createStoryForItem(item: RawItem, stream: string | null): Promise<Story>;
  storiesWithStatus(status: StoryStatus, limit?: number): Promise<StoryWithItems[]>;
  updateStory(id: string, patch: StoryPatch): Promise<void>;
  expireClassified(olderThan: Date): Promise<number>;
  insertPost(post: NewPost, now: Date): Promise<PostRow>;
  retention(now: Date): Promise<{ contentCleared: number; storiesDeleted: number }>;
  lastOkRunFinishedAt(): Promise<Date | null>;
  startRun(provider: string, now: Date): Promise<string>;
  finishRun(id: string, record: RunRecord, now: Date): Promise<void>;
}

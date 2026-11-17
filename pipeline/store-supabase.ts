import type { SupabaseClient } from "@supabase/supabase-js";
import { postRowSchema, type PostRow } from "@/lib/schema";
import { CONTENT_TTL_DAYS, DEAD_STORY_TTL_DAYS } from "./retention";
import type {
  NewPost,
  NewRawItem,
  RawItem,
  RunRecord,
  Source,
  SourceResult,
  Store,
  Story,
  StoryPatch,
  StoryStatus,
  StoryWithItems,
} from "./types";

const ITEM_COLUMNS = "id, source_id, url, title, summary, published_at, content, og_image, story_id, fetched_at";
const STORY_COLUMNS = "id, stream, importance, status, attempts, created_at";
const CHUNK = 100;

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Production Store backed by Supabase with the service-role key (bypasses RLS). */
export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseClient) {}

  async listSources(): Promise<Source[]> {
    return check<Source[]>(
      await this.db
        .from("sources")
        .select("id, name, url, stream, fetch_mode, max_items_per_run, active, consecutive_failures")
        .eq("active", true),
      "listSources",
    );
  }

  async recordSourceResult(source: Source, result: SourceResult, now: Date): Promise<void> {
    const patch = result.ok
      ? { last_success_at: now.toISOString(), last_error: null, consecutive_failures: 0 }
      : { last_error: result.error, consecutive_failures: source.consecutive_failures + 1 };
    check(await this.db.from("sources").update(patch).eq("id", source.id), "recordSourceResult");
  }

  async findExistingUrls(urls: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (const part of chunks(urls, CHUNK)) {
      const rows = check<{ url: string }[]>(
        await this.db.from("raw_items").select("url").in("url", part),
        "findExistingUrls",
      );
      for (const r of rows) found.add(r.url);
    }
    return found;
  }

  async insertRawItems(items: NewRawItem[]): Promise<RawItem[]> {
    if (items.length === 0) return [];
    return check<RawItem[]>(
      await this.db
        .from("raw_items")
        .upsert(items, { onConflict: "url", ignoreDuplicates: true })
        .select(ITEM_COLUMNS),
      "insertRawItems",
    );
  }

  async unassignedItems(): Promise<RawItem[]> {
    return check<RawItem[]>(
      await this.db.from("raw_items").select(ITEM_COLUMNS).is("story_id", null).limit(500),
      "unassignedItems",
    );
  }

  async createStoryForItem(item: RawItem, stream: string | null): Promise<Story> {
    const story = check<Story>(
      await this.db.from("stories").insert({ stream }).select(STORY_COLUMNS).single(),
      "createStory",
    );
    check(await this.db.from("raw_items").update({ story_id: story.id }).eq("id", item.id), "linkItem");
    return story;
  }

  async storiesWithStatus(status: StoryStatus, limit = 1000): Promise<StoryWithItems[]> {
    return check<StoryWithItems[]>(
      await this.db
        .from("stories")
        .select(`${STORY_COLUMNS}, items:raw_items(${ITEM_COLUMNS})`)
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(limit),
      "storiesWithStatus",
    );
  }

  async updateStory(id: string, patch: StoryPatch): Promise<void> {
    check(await this.db.from("stories").update(patch).eq("id", id), "updateStory");
  }

  async expireClassified(olderThan: Date): Promise<number> {
    const rows = check<{ id: string }[]>(
      await this.db
        .from("stories")
        .update({ status: "rejected" })
        .eq("status", "classified")
        .lt("created_at", olderThan.toISOString())
        .select("id"),
      "expireClassified",
    );
    return rows.length;
  }

  async insertPost(post: NewPost, now: Date): Promise<PostRow> {
    const row = check<unknown>(
      await this.db
        .from("posts")
        .insert({ ...post, published_at: now.toISOString() })
        .select("id, story_id, stream, headline, tldr, body_md, takeaways, links, image_url, diagram_svg, importance, boost, published_at")
        .single(),
      "insertPost",
    );
    return postRowSchema.parse(row);
  }

  async retention(now: Date): Promise<{ contentCleared: number; storiesDeleted: number }> {
    const contentCutoff = new Date(now.getTime() - CONTENT_TTL_DAYS * 86_400_000).toISOString();
    const storyCutoff = new Date(now.getTime() - DEAD_STORY_TTL_DAYS * 86_400_000).toISOString();
    const cleared = check<{ id: string }[]>(
      await this.db
        .from("raw_items")
        .update({ content: null })
        .lt("fetched_at", contentCutoff)
        .not("content", "is", null)
        .select("id"),
      "retention.content",
    );
    const deleted = check<{ id: string }[]>(
      await this.db
        .from("stories")
        .delete()
        .in("status", ["rejected", "failed"])
        .lt("created_at", storyCutoff)
        .select("id"),
      "retention.stories",
    );
    return { contentCleared: cleared.length, storiesDeleted: deleted.length };
  }

  async lastOkRunFinishedAt(): Promise<Date | null> {
    const rows = check<{ finished_at: string | null }[]>(
      await this.db
        .from("pipeline_runs")
        .select("finished_at")
        .eq("status", "ok")
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(1),
      "lastOkRun",
    );
    const at = rows[0]?.finished_at;
    return at ? new Date(at) : null;
  }

  async startRun(provider: string, now: Date): Promise<string> {
    const row = check<{ id: string }>(
      await this.db
        .from("pipeline_runs")
        .insert({ provider, started_at: now.toISOString() })
        .select("id")
        .single(),
      "startRun",
    );
    return row.id;
  }

  async finishRun(id: string, record: RunRecord, now: Date): Promise<void> {
    check(
      await this.db
        .from("pipeline_runs")
        .update({ ...record, finished_at: now.toISOString() })
        .eq("id", id),
      "finishRun",
    );
  }
}

import { randomUUID } from "node:crypto";
import type { PostRow } from "@/lib/schema";
import { CONTENT_TTL_DAYS, DEAD_STORY_TTL_DAYS } from "./retention";
import type {
  NewPost,
  NewRawItem,
  RawItem,
  RunRecord,
  Source,
  SourceResult,
  SourceSeed,
  Store,
  Story,
  StoryPatch,
  StoryStatus,
  StoryWithItems,
} from "./types";

interface MemorySource extends Source {
  last_success_at: string | null;
  last_error: string | null;
}

interface MemoryRun extends RunRecord {
  id: string;
  provider: string;
  started_at: string;
  finished_at: string | null;
}

/** In-memory Store for `--dry-run` and tests. Mirrors the SQL schema's behavior. */
export class MemoryStore implements Store {
  readonly sources: MemorySource[];
  readonly items: RawItem[] = [];
  readonly stories: Story[] = [];
  readonly posts: PostRow[] = [];
  readonly runs: MemoryRun[] = [];

  constructor(seeds: readonly SourceSeed[], private readonly clock: () => Date = () => new Date()) {
    this.sources = seeds.map((s) => ({
      ...s,
      id: randomUUID(),
      active: true,
      consecutive_failures: 0,
      last_success_at: null,
      last_error: null,
    }));
  }

  async listSources(): Promise<Source[]> {
    return this.sources.map((s) => ({ ...s }));
  }

  async recordSourceResult(source: Source, result: SourceResult, now: Date): Promise<void> {
    const s = this.sources.find((x) => x.id === source.id);
    if (!s) return;
    if (result.ok) {
      s.last_success_at = now.toISOString();
      s.last_error = null;
      s.consecutive_failures = 0;
    } else {
      s.last_error = result.error;
      s.consecutive_failures += 1;
    }
  }

  async findExistingUrls(urls: string[]): Promise<Set<string>> {
    const known = new Set(this.items.map((i) => i.url));
    return new Set(urls.filter((u) => known.has(u)));
  }

  async insertRawItems(items: NewRawItem[]): Promise<RawItem[]> {
    const inserted: RawItem[] = [];
    for (const item of items) {
      if (this.items.some((i) => i.url === item.url)) continue;
      const row: RawItem = { ...item, id: randomUUID(), story_id: null, fetched_at: this.clock().toISOString() };
      this.items.push(row);
      inserted.push(row);
    }
    return inserted;
  }

  async unassignedItems(): Promise<RawItem[]> {
    return this.items.filter((i) => i.story_id === null);
  }

  async createStoryForItem(item: RawItem, stream: string | null): Promise<Story> {
    const story: Story = {
      id: randomUUID(),
      stream,
      importance: null,
      status: "new",
      attempts: 0,
      created_at: this.clock().toISOString(),
    };
    this.stories.push(story);
    const row = this.items.find((i) => i.id === item.id);
    if (row) row.story_id = story.id;
    return story;
  }

  async storiesWithStatus(status: StoryStatus, limit = 1000): Promise<StoryWithItems[]> {
    return this.stories
      .filter((s) => s.status === status)
      .slice(0, limit)
      .map((s) => ({ ...s, items: this.items.filter((i) => i.story_id === s.id) }));
  }

  async updateStory(id: string, patch: StoryPatch): Promise<void> {
    const s = this.stories.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
  }

  async expireClassified(olderThan: Date): Promise<number> {
    let n = 0;
    for (const s of this.stories) {
      if (s.status === "classified" && new Date(s.created_at) < olderThan) {
        s.status = "rejected";
        n++;
      }
    }
    return n;
  }

  async insertPost(post: NewPost, now: Date): Promise<PostRow> {
    if (this.posts.some((p) => p.story_id === post.story_id)) {
      throw new Error(`duplicate post for story ${post.story_id}`);
    }
    const row: PostRow = {
      ...post,
      id: randomUUID(),
      diagram_svg: null,
      boost: 0,
      published_at: now.toISOString(),
    };
    this.posts.push(row);
    return row;
  }

  async retention(now: Date): Promise<{ contentCleared: number; storiesDeleted: number }> {
    const contentCutoff = now.getTime() - CONTENT_TTL_DAYS * 86_400_000;
    const storyCutoff = now.getTime() - DEAD_STORY_TTL_DAYS * 86_400_000;
    let contentCleared = 0;
    for (const i of this.items) {
      if (i.content !== null && new Date(i.fetched_at).getTime() < contentCutoff) {
        i.content = null;
        contentCleared++;
      }
    }
    const dead = this.stories.filter(
      (s) => (s.status === "rejected" || s.status === "failed") && new Date(s.created_at).getTime() < storyCutoff,
    );
    for (const s of dead) {
      this.stories.splice(this.stories.indexOf(s), 1);
      for (const i of this.items) if (i.story_id === s.id) i.story_id = null;
    }
    return { contentCleared, storiesDeleted: dead.length };
  }

  async lastOkRunFinishedAt(): Promise<Date | null> {
    const ok = this.runs.filter((r) => r.status === "ok" && r.finished_at).map((r) => r.finished_at ?? "");
    const last = ok.sort().at(-1);
    return last ? new Date(last) : null;
  }

  async startRun(provider: string, now: Date): Promise<string> {
    const id = randomUUID();
    this.runs.push({
      id,
      provider,
      started_at: now.toISOString(),
      finished_at: null,
      status: "running",
      counts: {},
      llm_calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      est_cost_usd: 0,
      error: null,
    });
    return id;
  }

  async finishRun(id: string, record: RunRecord, now: Date): Promise<void> {
    const run = this.runs.find((r) => r.id === id);
    if (run) Object.assign(run, record, { finished_at: now.toISOString() });
  }
}

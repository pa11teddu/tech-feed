// Server-only module: imported from Server Components and Route Handlers.
import { z } from "zod";
import { createServerSupabase } from "./db";
import { isMockMode } from "./env";
import { MOCK_POSTS } from "./mock-posts";
import { FEED_DECAY_HOURS, sortByFeedScore } from "./rank";
import { postRowSchema, type PostRow } from "./schema";

export const PAGE_SIZE = 20;
const POST_COLUMNS =
  "id, story_id, stream, headline, tldr, body_md, takeaways, links, image_url, diagram_svg, importance, boost, published_at";

export interface FeedPage {
  posts: PostRow[];
  nextOffset: number | null;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthorizedError";
  }
}

async function authedClient() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new UnauthorizedError();
  return supabase;
}

function page(posts: PostRow[], offset: number): FeedPage {
  return { posts, nextOffset: posts.length === PAGE_SIZE ? offset + PAGE_SIZE : null };
}

export async function getFeedPage(stream: string | null, offset: number): Promise<FeedPage> {
  if (isMockMode()) {
    const all = sortByFeedScore(MOCK_POSTS.filter((p) => !stream || p.stream === stream));
    return page(all.slice(offset, offset + PAGE_SIZE), offset);
  }
  const supabase = await authedClient();
  const { data, error } = await supabase.rpc("feed", {
    p_stream: stream,
    p_limit: PAGE_SIZE,
    p_offset: offset,
    p_decay_hours: FEED_DECAY_HOURS,
  });
  if (error) throw new Error(`feed query failed: ${error.message}`);
  return page(z.array(postRowSchema).parse(data ?? []), offset);
}

export async function getPostStreams(): Promise<string[]> {
  if (isMockMode()) return [...new Set(MOCK_POSTS.map((p) => p.stream))];
  const supabase = await authedClient();
  const { data, error } = await supabase.rpc("post_streams");
  if (error) throw new Error(`stream query failed: ${error.message}`);
  return z.array(z.string()).parse(data ?? []);
}

const uuid = z.string().uuid();

export async function getPost(id: string): Promise<PostRow | null> {
  if (!uuid.safeParse(id).success) return null;
  if (isMockMode()) return MOCK_POSTS.find((p) => p.id === id) ?? null;
  const supabase = await authedClient();
  const { data, error } = await supabase.from("posts").select(POST_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`post query failed: ${error.message}`);
  return data ? postRowSchema.parse(data) : null;
}

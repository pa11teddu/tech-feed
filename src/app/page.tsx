import { Feed } from "@/components/Feed";
import { StreamBar } from "@/components/StreamBar";
import { getFeedPage, getPostStreams, type FeedPage } from "@/lib/feed-data";
import { isStreamId } from "@/lib/streams";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const stream = typeof params.s === "string" && isStreamId(params.s) ? params.s : null;

  let streams: string[] = [];
  let first: FeedPage = { posts: [], nextOffset: null };
  let error: string | null = null;
  try {
    [streams, first] = await Promise.all([getPostStreams(), getFeedPage(stream, 0)]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not load the feed";
  }

  return (
    <>
      <StreamBar streams={streams} active={stream} />
      <Feed
        key={stream ?? "all"}
        stream={stream}
        initialPosts={first.posts}
        initialNextOffset={first.nextOffset}
        initialError={error}
      />
    </>
  );
}

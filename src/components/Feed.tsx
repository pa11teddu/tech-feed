"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PostRow } from "@/lib/schema";
import { PostCard } from "./PostCard";
import { PullToRefresh } from "./PullToRefresh";
import { Skeleton } from "./Skeleton";

interface FeedResponse {
  posts: PostRow[];
  nextOffset: number | null;
}

class SignedOutError extends Error {}

async function fetchPage(stream: string | null, offset: number): Promise<FeedResponse> {
  const params = new URLSearchParams({ offset: String(offset) });
  if (stream) params.set("s", stream);
  const res = await fetch(`/api/feed?${params.toString()}`, { cache: "no-store" });
  if (res.status === 401) throw new SignedOutError("Signed out");
  if (!res.ok) throw new Error(`Feed request failed (${res.status})`);
  return (await res.json()) as FeedResponse;
}

export function Feed({
  stream,
  initialPosts,
  initialNextOffset,
  initialError,
}: {
  stream: string | null;
  initialPosts: PostRow[];
  initialNextOffset: number | null;
  initialError: string | null;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const router = useRouter();
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (inFlight.current || nextOffset === null) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const page = await fetchPage(stream, nextOffset);
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.posts.filter((p) => !seen.has(p.id))];
      });
      setNextOffset(page.nextOffset);
      setError(null);
    } catch (err) {
      if (err instanceof SignedOutError) router.replace("/login");
      setError(err instanceof Error ? err.message : "Could not load more posts");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [stream, nextOffset, router]);

  const refresh = useCallback(async () => {
    try {
      const page = await fetchPage(stream, 0);
      setPosts(page.posts);
      setNextOffset(page.nextOffset);
      setError(null);
    } catch (err) {
      if (err instanceof SignedOutError) router.replace("/login");
      setError(err instanceof Error ? err.message : "Could not refresh");
    }
  }, [stream, router]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || nextOffset === null || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, nextOffset, error]);

  return (
    <PullToRefresh onRefresh={refresh}>
      <main className="px-safe pb-safe mx-auto max-w-2xl pt-4">
        {posts.length === 0 && !error && !loading && (
          <section className="rounded-2xl border border-dashed border-border p-8 text-center">
            <h2 className="font-serif text-xl font-semibold">No posts yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              New posts arrive at 6 AM and 6 PM Pacific. Pull down to refresh.
            </p>
          </section>
        )}

        <ol className="space-y-4">
          {posts.map((post, i) => (
            <li key={post.id}>
              <PostCard post={post} eagerImage={i === 0} />
            </li>
          ))}
        </ol>

        {loading && (
          <div className="mt-4">
            <Skeleton count={posts.length === 0 ? 3 : 1} />
          </div>
        )}

        {error && (
          <section role="alert" className="mt-4 rounded-2xl border border-border bg-card p-6 text-center">
            <h2 className="font-semibold">Something went wrong</h2>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => void (posts.length === 0 ? refresh() : loadMore())}
              className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full bg-primary px-5 text-sm font-semibold text-on-primary"
            >
              Try again
            </button>
          </section>
        )}

        <div ref={sentinel} aria-hidden="true" className="h-px" />
        {nextOffset === null && posts.length > 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        )}
      </main>
    </PullToRefresh>
  );
}

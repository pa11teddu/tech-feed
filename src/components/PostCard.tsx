"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { formatPostTime } from "@/lib/format";
import type { PostRow } from "@/lib/schema";
import { DeepDive } from "./DeepDive";
import { ChevronDown } from "./Icons";
import { PostImage } from "./PostImage";
import { StreamChip } from "./StreamChip";

export function PostCard({
  post,
  defaultExpanded = false,
  eagerImage = false,
  linkHeadline = true,
}: {
  post: PostRow;
  defaultExpanded?: boolean;
  eagerImage?: boolean;
  linkHeadline?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const panelId = useId();
  const headingId = useId();

  return (
    <article aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
      <PostImage src={post.image_url} stream={post.stream} eager={eagerImage} />
      <div className="p-4">
        <div className="flex items-center gap-2">
          <StreamChip stream={post.stream} />
          <time dateTime={post.published_at} className="text-xs text-muted-foreground">
            {formatPostTime(post.published_at)}
          </time>
        </div>
        <h2 id={headingId} className="mt-3 text-balance font-serif text-[1.35rem] font-semibold leading-snug">
          {linkHeadline ? (
            <Link href={`/post/${post.id}`} className="hover:underline">
              {post.headline}
            </Link>
          ) : (
            post.headline
          )}
        </h2>
        <p className="mt-2 text-[0.975rem] leading-relaxed text-card-foreground/90">
          <span className="font-semibold">TL;DR </span>
          {post.tldr}
        </p>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg pr-2 text-sm font-semibold text-link transition-colors duration-200"
        >
          {expanded ? "Show less" : "Read more"}
          <ChevronDown className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
        </button>

        {expanded && <DeepDive post={post} id={panelId} />}
      </div>
    </article>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@/components/Icons";
import { PostCard } from "@/components/PostCard";
import { ShareButton } from "@/components/ShareButton";
import { getPost } from "@/lib/feed-data";

export const metadata: Metadata = { title: "Post · Tech Feed" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();

  return (
    <>
      <header className="pt-safe sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="px-safe mx-auto flex max-w-2xl items-center justify-between py-1">
          <Link
            href="/"
            className="-ml-2 flex min-h-11 items-center gap-1 rounded-full pr-3 pl-2 text-sm font-semibold hover:bg-muted"
          >
            <ArrowLeft />
            Feed
          </Link>
          <ShareButton title={post.headline} text={post.tldr} />
        </div>
      </header>
      <main className="px-safe pb-safe mx-auto max-w-2xl pt-4">
        <PostCard post={post} defaultExpanded eagerImage linkHeadline={false} />
      </main>
    </>
  );
}

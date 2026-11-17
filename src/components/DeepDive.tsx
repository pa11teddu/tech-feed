import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { PostRow } from "@/lib/schema";
import { ExternalLink } from "./Icons";

/** Expanded body: sanitized Markdown, takeaways, and source links. */
export function DeepDive({ post, id }: { post: PostRow; id: string }) {
  return (
    <div id={id} className="mt-4 space-y-6">
      <div className="prose-feed max-w-prose text-card-foreground">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
            h1: ({ children }) => <h3>{children}</h3>,
            h2: ({ children }) => <h3>{children}</h3>,
          }}
        >
          {post.body_md}
        </ReactMarkdown>
      </div>

      {post.takeaways.length > 0 && (
        <section aria-label="Key takeaways" className="rounded-xl bg-muted p-4">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Takeaways</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-[0.95rem] leading-relaxed">
            {post.takeaways.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Sources">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sources</h3>
        <ul>
          {post.links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-2 text-link underline-offset-2 hover:underline"
              >
                <span className="line-clamp-2">{link.title}</span>
                <ExternalLink className="shrink-0" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

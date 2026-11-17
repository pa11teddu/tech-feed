import { z } from "zod";
import { STREAM_IDS } from "./streams";

export const MAX_QUOTE_WORDS = 15;
export const HEADLINE_MAX = 90;
export const BODY_MIN_WORDS = 250;
export const BODY_MAX_WORDS = 600;

export function countWords(text: string): number {
  const words = text
    .replace(/[`*_#>\-[\]()]/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length;
}

export function countSentences(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .filter((s) => s.trim().length > 0).length;
}

/** Longest double-quoted span, in words. Used to enforce the quote rule. */
export function longestQuoteWords(text: string): number {
  const re = /["“]([^"”]+)["”]/g;
  let max = 0;
  for (const match of text.matchAll(re)) {
    const inner = match[1] ?? "";
    max = Math.max(max, countWords(inner));
  }
  return max;
}

export const streamSchema = z.enum(STREAM_IDS);

export const classifyItemSchema = z.object({
  id: z.string().min(1),
  stream: streamSchema,
  importance: z.number().int().min(1).max(10),
  is_noise: z.boolean(),
});
export type ClassifyItem = z.infer<typeof classifyItemSchema>;

export const classifyResponseSchema = z.object({
  results: z.array(classifyItemSchema),
});
export type ClassifyResponse = z.infer<typeof classifyResponseSchema>;

export const linkSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().url(),
});
export type PostLink = z.infer<typeof linkSchema>;

export const generatedPostSchema = z
  .object({
    headline: z.string().trim().min(10).max(HEADLINE_MAX),
    tldr: z
      .string()
      .trim()
      .min(20)
      .max(400)
      .refine((s) => countSentences(s) <= 2, "tldr must be at most 2 sentences"),
    body_md: z
      .string()
      .trim()
      .refine((s) => countWords(s) >= BODY_MIN_WORDS, `body_md must be at least ${BODY_MIN_WORDS} words`)
      .refine((s) => countWords(s) <= BODY_MAX_WORDS, `body_md must be at most ${BODY_MAX_WORDS} words`),
    takeaways: z.array(z.string().trim().min(3).max(240)).min(2).max(5),
    links: z.array(linkSchema).min(1).max(10),
  })
  .superRefine((post, ctx) => {
    const text = [post.headline, post.tldr, post.body_md, ...post.takeaways].join("\n");
    const longest = longestQuoteWords(text);
    if (longest > MAX_QUOTE_WORDS) {
      ctx.addIssue({
        code: "custom",
        message: `quotes must be at most ${MAX_QUOTE_WORDS} words (found ${longest})`,
        path: ["body_md"],
      });
    }
  });
export type GeneratedPost = z.infer<typeof generatedPostSchema>;

/** Shape of a post as stored in `posts` and returned to the web app. */
export interface PostRow {
  id: string;
  story_id: string | null;
  stream: string;
  headline: string;
  tldr: string;
  body_md: string;
  takeaways: string[];
  links: PostLink[];
  image_url: string | null;
  diagram_svg: string | null;
  importance: number;
  boost: number;
  published_at: string;
}

export const postRowSchema = z.object({
  id: z.string(),
  story_id: z.string().nullable(),
  stream: z.string(),
  headline: z.string(),
  tldr: z.string(),
  body_md: z.string(),
  takeaways: z.array(z.string()),
  links: z.array(linkSchema),
  image_url: z.string().nullable(),
  diagram_svg: z.string().nullable(),
  importance: z.number(),
  boost: z.number(),
  published_at: z.string(),
});

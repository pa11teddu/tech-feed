import { canonicalizeUrl } from "./url";
import type { PostLink } from "./schema";

export interface LinkValidation {
  kept: PostLink[];
  dropped: PostLink[];
}

/**
 * Hallucination guard: every link must point at one of the story's input
 * URLs (compared canonically). Foreign links are dropped; duplicates collapse.
 * Kept links use the stored input URL, not the model's spelling of it.
 */
export function validateLinks(links: readonly PostLink[], allowedUrls: Iterable<string>): LinkValidation {
  const allowed = new Map<string, string>();
  for (const url of allowedUrls) {
    const canon = canonicalizeUrl(url);
    if (canon) allowed.set(canon, url);
  }
  const kept: PostLink[] = [];
  const dropped: PostLink[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const canon = canonicalizeUrl(link.url);
    const original = canon ? allowed.get(canon) : undefined;
    if (!canon || !original) {
      dropped.push(link);
      continue;
    }
    if (seen.has(canon)) continue;
    seen.add(canon);
    kept.push({ title: link.title.trim(), url: original });
  }
  return { kept, dropped };
}

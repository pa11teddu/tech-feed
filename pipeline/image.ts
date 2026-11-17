import { isHttpsUrl } from "@/lib/url";

const PLACEHOLDER_PATTERNS = [
  /logo/i,
  /favicon/i,
  /placeholder/i,
  /default[-_]?(og|share|social|image)/i,
  /\/avatars?\//i,
  /gravatar\.com/i,
  /opengraph\.githubassets\.com/i,
  /arxiv\.org\/static/i,
  /\.svg(\?|$)/i,
  /\.ico(\?|$)/i,
  /spacer|blank\.(gif|png)/i,
];

export function isUsableImage(url: string | null | undefined): url is string {
  if (!url || !isHttpsUrl(url)) return false;
  return !PLACEHOLDER_PATTERNS.some((re) => re.test(url));
}

/** Best og:image in the cluster: the first absolute https URL that is not a logo or placeholder. */
export function pickImage(candidates: readonly (string | null | undefined)[]): string | null {
  return candidates.find(isUsableImage) ?? null;
}

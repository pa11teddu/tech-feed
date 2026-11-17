/**
 * Feed decay constant (hours). This is the single source of truth: the SQL
 * `feed()` function takes it as a required argument, so it is never duplicated.
 * score = importance * exp(-age_hours / FEED_DECAY_HOURS) + boost
 */
export const FEED_DECAY_HOURS = 36;

export function feedScore(importance: number, ageHours: number, boost = 0): number {
  const age = Math.max(0, ageHours);
  return importance * Math.exp(-age / FEED_DECAY_HOURS) + boost;
}

export interface Scorable {
  importance: number;
  boost: number;
  published_at: string;
}

/** Mirrors the SQL ordering: score desc, then published_at desc. */
export function sortByFeedScore<T extends Scorable>(posts: readonly T[], now: Date = new Date()): T[] {
  const scored = posts.map((p) => {
    const ageHours = (now.getTime() - new Date(p.published_at).getTime()) / 3_600_000;
    return { p, s: feedScore(p.importance, ageHours, p.boost) };
  });
  scored.sort((a, b) => b.s - a.s || b.p.published_at.localeCompare(a.p.published_at));
  return scored.map((x) => x.p);
}

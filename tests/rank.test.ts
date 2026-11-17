import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEED_DECAY_HOURS, feedScore, sortByFeedScore } from "@/lib/rank";

describe("feed score", () => {
  it("is importance * exp(-age_hours / 36) + boost", () => {
    expect(FEED_DECAY_HOURS).toBe(36);
    expect(feedScore(10, 0)).toBe(10);
    expect(feedScore(10, 36)).toBeCloseTo(10 / Math.E, 10);
    expect(feedScore(8, 12, 0.5)).toBeCloseTo(8 * Math.exp(-12 / 36) + 0.5, 10);
  });

  it("treats future timestamps as age 0", () => {
    expect(feedScore(7, -5)).toBe(7);
  });

  it("lets a fresh mid-importance post outrank a stale important one", () => {
    expect(feedScore(6, 1)).toBeGreaterThan(feedScore(9, 24));
  });

  it("orders by score desc, then published_at desc", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const posts = [
      { id: "old-important", importance: 9, boost: 0, published_at: "2026-11-15T12:00:00Z" },
      { id: "fresh", importance: 7, boost: 0, published_at: "2026-11-17T11:00:00Z" },
      // Equal score (importance 0) → newer published_at wins the tie.
      { id: "tie-older", importance: 0, boost: 1, published_at: "2026-11-16T10:00:00Z" },
      { id: "tie-newer", importance: 0, boost: 1, published_at: "2026-11-17T10:00:00Z" },
    ];
    const ids = sortByFeedScore(posts, now).map((p) => p.id);
    expect(ids).toEqual(["fresh", "old-important", "tie-newer", "tie-older"]);
  });

  it("the SQL feed() takes the decay constant as a required argument (single source of truth)", () => {
    const sql = readFileSync("supabase/migrations/0001_init.sql", "utf8");
    expect(sql).toMatch(/feed\(p_stream text, p_limit int, p_offset int, p_decay_hours float\)/);
    expect(sql).toMatch(/exp\(-\(extract\(epoch from \(now\(\) - p\.published_at\)\) \/ 3600\.0\) \/ p_decay_hours\) \+ p\.boost desc/);
    expect(sql).not.toMatch(/p_decay_hours float default/);
  });
});

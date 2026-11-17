import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localHour, shouldRun } from "../pipeline/schedule-gate";

const TZ = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);

describe("DST-safe schedule gate", () => {
  it("summer (PDT, UTC-7): 13:00 and 01:00 UTC run; 14:00 and 02:00 UTC skip", () => {
    expect(shouldRun(at("2026-07-01T13:00:00Z"), TZ)).toBe(true); // 6 AM PDT
    expect(shouldRun(at("2026-07-02T01:00:00Z"), TZ)).toBe(true); // 6 PM PDT
    expect(shouldRun(at("2026-07-01T14:00:00Z"), TZ)).toBe(false); // 7 AM
    expect(shouldRun(at("2026-07-02T02:00:00Z"), TZ)).toBe(false); // 7 PM
  });

  it("winter (PST, UTC-8): 14:00 and 02:00 UTC run; 13:00 and 01:00 UTC skip", () => {
    expect(shouldRun(at("2026-01-15T14:00:00Z"), TZ)).toBe(true); // 6 AM PST
    expect(shouldRun(at("2026-01-16T02:00:00Z"), TZ)).toBe(true); // 6 PM PST
    expect(shouldRun(at("2026-01-15T13:00:00Z"), TZ)).toBe(false); // 5 AM
    expect(shouldRun(at("2026-01-16T01:00:00Z"), TZ)).toBe(false); // 5 PM
  });

  it("handles the DST transition days (2026-03-08 spring forward, 2026-11-01 fall back)", () => {
    expect(shouldRun(at("2026-03-08T13:00:00Z"), TZ)).toBe(true); // 6 AM PDT, first day of DST
    expect(shouldRun(at("2026-03-08T14:00:00Z"), TZ)).toBe(false);
    expect(shouldRun(at("2026-11-01T14:00:00Z"), TZ)).toBe(true); // 6 AM PST, first day of standard time
    expect(shouldRun(at("2026-11-01T13:00:00Z"), TZ)).toBe(false);
  });

  it("exactly one morning and one evening cron slot runs on every day of the year", () => {
    for (let day = 0; day < 365; day++) {
      const base = Date.UTC(2026, 0, 1) + day * 86_400_000;
      const slots = [1, 2, 13, 14].map((h) => shouldRun(new Date(base + h * 3_600_000), TZ));
      expect(slots.filter(Boolean)).toHaveLength(2);
    }
  });

  it("force bypasses the gate", () => {
    expect(shouldRun(at("2026-07-01T20:00:00Z"), TZ, true)).toBe(true);
  });

  it("reports the local hour", () => {
    expect(localHour(at("2026-07-01T13:30:00Z"), TZ)).toBe(6);
    expect(localHour(at("2026-07-01T07:00:00Z"), TZ)).toBe(0);
  });

  it("the workflow cron matches the gate's UTC slots", () => {
    const yml = readFileSync(".github/workflows/pipeline.yml", "utf8");
    expect(yml).toContain('cron: "0 1,2,13,14 * * *"');
  });
});

/**
 * DST-safe schedule gate for .github/workflows/pipeline.yml.
 * Cron fires at 01,02,13,14 UTC; this lets exactly the runs whose local hour
 * (America/Los_Angeles by default) is 6 or 18 through.
 *
 * Kept dependency-free with only erasable TypeScript so the workflow can run it
 * with `node --experimental-strip-types` before `npm ci`.
 */
import { appendFileSync } from "node:fs";

export const RUN_HOURS: readonly number[] = [6, 18];

export function localHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(date)
    .find((p) => p.type === "hour")?.value;
  return Number(hour);
}

export function shouldRun(date: Date, timeZone: string, force = false): boolean {
  return force || RUN_HOURS.includes(localHour(date, timeZone));
}

function isMain(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("schedule-gate.ts");
}

if (isMain()) {
  const tz = process.env.APP_TIMEZONE || "America/Los_Angeles";
  const force = process.env.FORCE_RUN === "true";
  const now = new Date();
  const run = shouldRun(now, tz, force);
  console.log(`UTC ${now.toISOString()} → ${tz} hour ${localHour(now, tz)}; force=${force}; run=${run}`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `run=${run}\n`);
}

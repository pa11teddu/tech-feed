const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DISPLAY_TIMEZONE = "America/Los_Angeles";

/**
 * Deterministic "Nov 17 · 6:05 AM" in Pacific time. Built from numeric parts so
 * server and browser ICU differences can't cause hydration mismatches.
 */
export function formatPostTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour24 = get("hour");
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minute = String(get("minute")).padStart(2, "0");
  return `${MONTHS[get("month") - 1] ?? ""} ${get("day")} · ${hour12}:${minute} ${hour24 < 12 ? "AM" : "PM"}`;
}

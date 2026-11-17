import Link from "next/link";
import { isStreamId, STREAM_IDS, STREAMS } from "@/lib/streams";
import { LogOut } from "./Icons";

/**
 * Sticky header + horizontally scrollable stream tabs. Phase 1 shows All plus
 * streams that have posts; selection lives in the URL (?s=ai-ml).
 */
export function StreamBar({ streams, active }: { streams: readonly string[]; active: string | null }) {
  const present = STREAM_IDS.filter((id) => streams.includes(id));
  const tabs: { id: string | null; label: string }[] = [
    { id: null, label: "All" },
    ...present.map((id) => ({ id, label: STREAMS[id].label })),
  ];
  if (active && isStreamId(active) && !present.includes(active)) {
    tabs.push({ id: active, label: STREAMS[active].label });
  }

  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="px-safe mx-auto flex max-w-2xl items-center justify-between pt-2">
        <h1 className="font-serif text-2xl font-bold tracking-tight">Tech Feed</h1>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            aria-label="Sign out"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-muted"
          >
            <LogOut />
          </button>
        </form>
      </div>
      <nav aria-label="Streams" className="mx-auto max-w-2xl">
        <ul className="no-scrollbar px-safe flex snap-x scroll-px-4 gap-2 overflow-x-auto py-2">
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <li key={tab.id ?? "all"} className="snap-start">
                <Link
                  href={tab.id ? `/?s=${tab.id}` : "/"}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors duration-200 ${
                    isActive
                      ? "bg-primary text-on-primary"
                      : "border border-border bg-card text-foreground hover:bg-muted"
                  }`}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

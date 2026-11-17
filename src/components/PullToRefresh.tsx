"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Refresh } from "./Icons";

const THRESHOLD = 70;
const MAX_PULL = 110;

/**
 * Custom pull-to-refresh: iOS standalone PWAs have no native one. Engages only
 * when the page is scrolled to the very top.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void>; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (busy.current || window.scrollY > 0) return;
      start.current = e.touches[0]?.clientY ?? null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - start.current;
      if (dy <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const distance = Math.min(MAX_PULL, dy * 0.5);
      pullRef.current = distance;
      setDragging(true);
      setPull(distance);
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = async () => {
      if (start.current === null) return;
      start.current = null;
      setDragging(false);
      const triggered = pullRef.current >= THRESHOLD;
      pullRef.current = 0;
      if (!triggered) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(THRESHOLD * 0.6);
      try {
        await onRefresh();
      } finally {
        busy.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [onRefresh]);

  const progress = Math.min(1, pull / THRESHOLD);
  return (
    <div>
      <div
        className="flex items-center justify-center overflow-hidden text-muted-foreground"
        style={{ height: pull, transition: dragging ? "none" : "height 200ms ease" }}
        aria-hidden={!refreshing}
      >
        <Refresh
          className={refreshing ? "motion-safe:animate-spin" : ""}
          style={{ opacity: progress, transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
        />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {refreshing ? "Refreshing feed" : ""}
      </p>
      {children}
    </div>
  );
}

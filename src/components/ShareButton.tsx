"use client";

import { useState } from "react";
import { Share } from "./Icons";

export function ShareButton({ title, text }: { title: string; text: string }) {
  const [status, setStatus] = useState("");

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus("Link copied");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setStatus("Could not share");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {status}
      </span>
      <button
        type="button"
        onClick={() => void share()}
        aria-label="Share post"
        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors duration-200 hover:bg-muted"
      >
        <Share />
      </button>
    </div>
  );
}

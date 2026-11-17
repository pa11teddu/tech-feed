"use client";

import { useState } from "react";
import { streamLabel } from "@/lib/streams";
import { streamColors } from "./StreamChip";

/**
 * Fixed 16:9 frame. Plain <img> (no next/image: avoids Vercel image-optimization
 * quota), lazy, no referrer. Falls back to a stream-colored gradient on error.
 */
export function PostImage({ src, stream, eager = false }: { src: string | null; stream: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const { from, to } = streamColors(stream);
  const showImage = src && !failed;
  return (
    <div
      className="relative aspect-video w-full overflow-hidden bg-muted"
      style={showImage ? undefined : { backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-end p-4" aria-hidden="true">
          <svg className="absolute -right-6 -top-6 h-40 w-40 opacity-20" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="46" stroke="white" strokeWidth="2" />
            <circle cx="50" cy="50" r="30" stroke="white" strokeWidth="2" />
            <circle cx="50" cy="50" r="14" stroke="white" strokeWidth="2" />
          </svg>
          <span className="font-serif text-2xl font-semibold text-white/90">{streamLabel(stream)}</span>
        </div>
      )}
    </div>
  );
}

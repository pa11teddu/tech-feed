export const STREAM_IDS = [
  "ai-ml",
  "data-eng",
  "outages",
  "networking",
  "algorithms",
  "quantum",
  "devtools",
] as const;

export type StreamId = (typeof STREAM_IDS)[number];

export interface StreamInfo {
  id: StreamId;
  label: string;
  /** Two gradient stops used for chips and image fallbacks. */
  from: string;
  to: string;
}

export const STREAMS: Record<StreamId, StreamInfo> = {
  "ai-ml": { id: "ai-ml", label: "AI/ML", from: "#7c3aed", to: "#db2777" },
  "data-eng": { id: "data-eng", label: "Data Engineering", from: "#0f766e", to: "#0284c7" },
  outages: { id: "outages", label: "Outages", from: "#b91c1c", to: "#ea580c" },
  networking: { id: "networking", label: "Networking/Infra", from: "#1d4ed8", to: "#0891b2" },
  algorithms: { id: "algorithms", label: "Algorithms/CS", from: "#4338ca", to: "#7c3aed" },
  quantum: { id: "quantum", label: "Quantum", from: "#0e7490", to: "#4f46e5" },
  devtools: { id: "devtools", label: "Dev Tools", from: "#334155", to: "#0f766e" },
};

/** Streams that Phase 1 ingests from. */
export const PHASE1_STREAMS: readonly StreamId[] = ["ai-ml", "data-eng", "outages"];

export function isStreamId(value: unknown): value is StreamId {
  return typeof value === "string" && (STREAM_IDS as readonly string[]).includes(value);
}

export function streamLabel(id: string): string {
  return isStreamId(id) ? STREAMS[id].label : id;
}

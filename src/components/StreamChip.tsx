import { isStreamId, STREAMS, streamLabel } from "@/lib/streams";

export function streamColors(stream: string): { from: string; to: string } {
  return isStreamId(stream) ? STREAMS[stream] : { from: "#334155", to: "#475569" };
}

export function StreamChip({ stream }: { stream: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide text-white"
      style={{ backgroundColor: streamColors(stream).from }}
    >
      {streamLabel(stream)}
    </span>
  );
}

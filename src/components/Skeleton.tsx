export function SkeletonCard() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="aspect-video w-full bg-skeleton motion-safe:animate-pulse" />
      <div className="space-y-3 p-4">
        <div className="h-5 w-24 rounded-full bg-skeleton motion-safe:animate-pulse" />
        <div className="h-6 w-11/12 rounded bg-skeleton motion-safe:animate-pulse" />
        <div className="h-6 w-2/3 rounded bg-skeleton motion-safe:animate-pulse" />
        <div className="h-4 w-full rounded bg-skeleton motion-safe:animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-skeleton motion-safe:animate-pulse" />
      </div>
    </div>
  );
}

export function Skeleton({ count = 2 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading posts" className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

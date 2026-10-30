import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n";

export { Skeleton };

// Placeholder rows for a list of cards while it loads.
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label={t.common.loading} className="grid gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border bg-surface-raised p-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="size-10 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

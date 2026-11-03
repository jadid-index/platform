import Link from "next/link";

import { Button } from "@/components/ui/button";
import { format, t } from "@/i18n";

// Offset paging with plain links, so the URL holds the whole state.
export function Pager({
  base,
  params,
  offset,
  limit,
  total,
  shown,
}: {
  base: string;
  params: Record<string, string | undefined>;
  offset: number;
  limit: number;
  total: number;
  shown: number;
}) {
  if (total <= limit && offset === 0) return null;
  const href = (o: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    if (o > 0) qs.set("offset", String(o));
    const s = qs.toString();
    return s ? `${base}?${s}` : base;
  };
  const hasPrev = offset > 0;
  const hasNext = offset + shown < total;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-small text-muted-foreground tabular">
        {format(t.admin.pageOf, { from: shown ? offset + 1 : 0, to: offset + shown, total })}
      </p>
      <div className="flex gap-2">
        {hasPrev ? (
          <Button asChild variant="outline">
            <Link href={href(Math.max(0, offset - limit))}>{t.admin.prev}</Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            {t.admin.prev}
          </Button>
        )}
        {hasNext ? (
          <Button asChild variant="outline">
            <Link href={href(offset + limit)}>{t.admin.next}</Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            {t.admin.next}
          </Button>
        )}
      </div>
    </div>
  );
}

import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { checkReviewerPage } from "@/components/reviewer-gate";
import { Card, CardContent } from "@/components/ui/card";
import { achievementTypeName, format, formatAge, t } from "@/i18n";
import { listReviewQueue } from "@/lib/db";
import type { ReviewQueueItem } from "@/lib/types";

export const metadata: Metadata = { title: `${t.review.title} · ${t.common.appName}` };

export default function ReviewQueuePage() {
  return (
    <main className="grid gap-3">
      <Suspense fallback={<LoadingState />}>
        <Queue />
      </Suspense>
    </main>
  );
}

async function Queue() {
  const access = await checkReviewerPage();
  if ("denied" in access) return access.denied;

  let items: ReviewQueueItem[];
  try {
    items = await listReviewQueue();
  } catch (error) {
    console.error("load review queue failed", error);
    return <ErrorState message={t.review.queueError} />;
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-2 text-center text-muted-foreground">{t.review.queueEmpty}</CardContent>
      </Card>
    );
  }

  return (
    <>
      <h1 className="text-lg font-semibold">
        {t.review.queueTitle}{" "}
        <span className="text-sm font-normal text-muted-foreground">
          ({format(t.review.queueCount, { count: items.length })})
        </span>
      </h1>
      <ul className="grid gap-3">
        {items.map((s) => (
          <li key={s.id}>
            <Link
              href={`/review/${s.id}`}
              className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Card className="gap-2 py-4 transition-colors hover:bg-primary-soft">
                <CardContent className="flex items-center gap-3 px-4">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{s.student_name}</span>
                      <span className="text-xs text-muted-foreground">{formatAge(s.submitted_at)}</span>
                    </div>
                    {s.faculty ? <span className="text-sm text-muted-foreground">{s.faculty}</span> : null}
                    <span className="truncate">{s.title}</span>
                    <span className="text-sm text-muted-foreground">
                      {achievementTypeName(s.type_id, s.type_name)} · {t.levels[s.level]}
                      {s.result !== "confirmed" ? ` · ${t.results[s.result]}` : ""}
                    </span>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-label={t.review.open} />
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

import { AlertTriangle, CheckCircle2, ChevronRight, HelpCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Card, CardContent, Chip, EmptyState, ErrorState, ListSkeleton, SectionHeader } from "@/components/ds";
import { checkReviewerPage } from "@/components/reviewer-gate";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { achievementTypeName, format, formatAge, formatDate, t } from "@/i18n";
import { listReviewQueue } from "@/lib/db";
import type { ReviewQueueItem } from "@/lib/types";

export const metadata: Metadata = { title: `${t.review.title} · ${t.common.appName}` };

export default function ReviewQueuePage() {
  return (
    <div className="grid gap-4">
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Queue />
      </Suspense>
    </div>
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
      <>
        <SectionHeader as="h1" title={t.review.queueTitle} />
        <EmptyState text={t.review.queueEmpty} />
      </>
    );
  }

  // Oldest first, as listReviewQueue returns them. Desktop: a table; phones: cards. Both open the review screen.
  return (
    <>
      <SectionHeader
        as="h1"
        title={t.review.queueTitle}
        description={format(t.review.queueCount, { count: items.length })}
      />

      <div className="hidden overflow-hidden rounded-xl border bg-surface-raised lg:block">
        <Table>
          <TableCaption className="sr-only">{t.review.queueCaption}</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">{t.review.colStudent}</TableHead>
              <TableHead>{t.review.colType}</TableHead>
              <TableHead>{t.review.colSubmitted}</TableHead>
              <TableHead>{t.review.colFlags}</TableHead>
              <TableHead className="w-10 pr-4">
                <span className="sr-only">{t.review.open}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => (
              // relative + the link's ::after make the whole row clickable.
              <TableRow key={s.id} className="relative hover:bg-primary-soft/50">
                <TableCell className="pl-4 whitespace-normal">
                  <Link
                    href={`/review/${s.id}`}
                    className="font-medium outline-none after:absolute after:inset-0 hover:underline focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
                  >
                    {s.student_name}
                  </Link>
                  {s.faculty ? <div className="text-small text-muted-foreground">{s.faculty}</div> : null}
                </TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  <div className="truncate">{s.title}</div>
                  <div className="text-small text-muted-foreground">{typeLine(s)}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div className="tabular">{formatDate(s.submitted_at)}</div>
                  <div className="text-small text-muted-foreground">{formatAge(s.submitted_at)}</div>
                </TableCell>
                <TableCell>
                  <FlagChip count={s.flag_count} />
                </TableCell>
                <TableCell className="pr-4">
                  <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-3 lg:hidden">
        {items.map((s) => (
          <li key={s.id}>
            <Link
              href={`/review/${s.id}`}
              className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Card interactive className="gap-2 py-4">
                <CardContent className="flex items-center gap-3 px-4">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{s.student_name}</span>
                      <span className="text-xs text-muted-foreground">{formatAge(s.submitted_at)}</span>
                    </div>
                    {s.faculty ? <span className="text-small text-muted-foreground">{s.faculty}</span> : null}
                    <span className="truncate">{s.title}</span>
                    <span className="text-small text-muted-foreground">{typeLine(s)}</span>
                    <FlagChip count={s.flag_count} className="mt-1 w-fit" />
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

function typeLine(s: ReviewQueueItem): string {
  return `${achievementTypeName(s.type_id, s.type_name)} · ${t.levels[s.level]}${
    s.result !== "confirmed" ? ` · ${t.results[s.result]}` : ""
  }`;
}

// Recognition checks that need a look. Icon and words, never colour alone.
function FlagChip({ count, className }: { count: number | null; className?: string }) {
  if (count === null) {
    return (
      <Chip tone="muted" className={className}>
        <HelpCircle aria-hidden />
        {t.review.flagsNoData}
      </Chip>
    );
  }
  if (count === 0) {
    return (
      <Chip tone="approved" className={className}>
        <CheckCircle2 aria-hidden />
        {t.review.flagsNone}
      </Chip>
    );
  }
  return (
    <Chip tone="pending" className={className}>
      <AlertTriangle aria-hidden />
      {format(t.review.flagsCount, { n: count })}
    </Chip>
  );
}

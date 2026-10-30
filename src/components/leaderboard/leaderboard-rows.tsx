import Link from "next/link";

import { Card, CardContent, RankBadge, Skeleton } from "@/components/ds";
import { StudentAvatar } from "@/components/student-avatar";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, formatDate, t } from "@/i18n";
import type { LeaderboardRow } from "@/lib/types";
import { cn } from "@/lib/utils";

// Soft medal tint for places 1-3, on top of the RankBadge medal. Text keeps the normal text color.
const PODIUM: Record<number, string> = {
  1: "bg-rank-gold/35",
  2: "bg-rank-silver/45",
  3: "bg-rank-bronze/35",
};

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

// Desktop (lg and up): a table. Below lg: the same rows as cards. Each row opens the public profile.
// Rows arrive ranked; the order and rank numbers are shown exactly as given.
export function LeaderboardRows({ rows, latest }: { rows: LeaderboardRow[]; latest: Record<string, string> }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border bg-surface-raised lg:block">
        <Table>
          <TableCaption className="sr-only">{t.leaderboard.tableCaption}</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-20 pl-4">{t.leaderboard.colRank}</TableHead>
              <TableHead>{t.leaderboard.colStudent}</TableHead>
              <TableHead className="text-right">{t.leaderboard.colPoints}</TableHead>
              <TableHead className="w-36 pr-4 text-right">{t.leaderboard.colLastWork}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.student_id}
                // relative + the link's ::after make the whole row clickable.
                className={cn("relative hover:bg-primary-soft/50", PODIUM[row.rank])}
              >
                <TableCell className="pl-4">
                  <RankBadge rank={row.rank} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex items-center gap-3">
                    <StudentAvatar name={row.full_name} url={row.photo_url} className="size-9" />
                    <div className="grid min-w-0">
                      <Link
                        href={`/students/${row.student_id}`}
                        className="font-medium outline-none after:absolute after:inset-0 hover:underline focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
                      >
                        {row.full_name}
                      </Link>
                      {row.faculty ? <span className="text-small text-muted-foreground">{row.faculty}</span> : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold text-primary-strong tabular">
                  {format(t.leaderboard.points, { points: row.total_points })}
                </TableCell>
                <TableCell className="pr-4 text-right text-small text-muted-foreground tabular">
                  {latest[row.student_id] ? formatDate(latest[row.student_id]) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ol className="grid gap-2 lg:hidden">
        {rows.map((row) => (
          <li key={row.student_id}>
            <Link href={`/students/${row.student_id}`} className={cn("block rounded-xl", focusRing)}>
              <Card interactive className={cn("py-3", PODIUM[row.rank])}>
                <CardContent className="flex items-center gap-3 px-3 sm:px-4">
                  <RankBadge rank={row.rank} />
                  {/* No avatar on phones: the name needs the width. */}
                  <StudentAvatar name={row.full_name} url={row.photo_url} className="max-sm:hidden" />
                  <div className="grid min-w-0 flex-1">
                    <span className="font-medium break-words">{row.full_name}</span>
                    {row.faculty ? <span className="truncate text-small text-muted-foreground">{row.faculty}</span> : null}
                    {latest[row.student_id] ? (
                      <span className="truncate text-xs text-muted-foreground tabular">
                        {format(t.leaderboard.lastWork, { date: formatDate(latest[row.student_id]) })}
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-right font-semibold text-primary-strong tabular">
                    {format(t.leaderboard.points, { points: row.total_points })}
                  </span>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

// Same shapes as LeaderboardRows while the data loads.
export function LeaderboardSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label={t.common.loading}>
      <div className="hidden divide-y rounded-xl border bg-surface-raised lg:block">
        <div className="flex gap-4 px-4 py-3">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-2 lg:hidden">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border bg-surface-raised p-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="size-10 rounded-full max-sm:hidden" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";

import { Card, CardContent, Skeleton, TierBadge } from "@/components/ds";
import { StudentAvatar } from "@/components/student-avatar";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format, formatDate, t, typeName } from "@/i18n";
import type { LeaderboardView } from "@/lib/leaderboard-view";
import type { LeaderboardRow, PublicTier } from "@/lib/types";

const focusRing =
  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

type Group = { key: string; tier: PublicTier | null; rows: LeaderboardRow[] };

// Rows arrive in public order (tier, then name), so consecutive rows with the same tier form one section.
function groupByTier(rows: LeaderboardRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const key = row.tier?.code ?? "";
    const last = groups.at(-1);
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, tier: row.tier, rows: [row] });
  }
  return groups;
}

const sectionTitle = (tier: PublicTier | null) =>
  tier ? t.achievement.level : t.leaderboard.noTierSection;
// format(t.leaderboard.tierSection, { tier: typeName(tier.label) });

type RowsProps = { rows: LeaderboardRow[]; latest: Record<string, string> };

// Picks the layout. Every view gets the same rows in the same public order (tier, then name; rule 11):
// no rank numbers, no points, no medals.
// counts: everyone in each tier for these filters (the page may show only the first rows of the last section).
export function LeaderboardRows({
  view,
  rows,
  latest,
  counts,
}: RowsProps & { view: LeaderboardView; counts: Record<string, number> }) {
  switch (view) {
    case "list":
      return <FlatRows rows={rows} latest={latest} />;
    case "tiers":
      return <TieredRows rows={rows} latest={latest} counts={counts} />;
  }
}

// One section per tier, best first; within a tier, names in alphabetical order.
function TieredRows({ rows, latest, counts }: RowsProps & { counts: Record<string, number> }) {
  return (
    <div className="grid gap-6">
      {groupByTier(rows).map((group) => {
        const title = sectionTitle(group.tier);
        const headingId = `tier-${group.key || "none"}`;
        return (
          <section key={group.key} aria-labelledby={headingId} className="grid gap-3">
            <div className="flex items-center gap-3">
              <TierBadge tier={group.tier} />
              <div className="grid">
                <h2 id={headingId} className="text-body font-semibold lowercase">
                  {title}
                </h2>
                <p className="text-small text-muted-foreground">
                  {format(t.leaderboard.sectionCount, { n: counts[group.key] ?? group.rows.length })}
                </p>
              </div>
            </div>
            <RowsTable
              rows={group.rows}
              latest={latest}
              caption={format(t.leaderboard.tableCaption, { tier: title })}
            />
            <RowsCards rows={group.rows} latest={latest} />
          </section>
        );
      })}
    </div>
  );
}

// One continuous list in the same order, with the tier badge on every row instead of section headings.
function FlatRows({ rows, latest }: RowsProps) {
  return (
    <div className="grid gap-3">
      <RowsTable rows={rows} latest={latest} caption={t.leaderboard.tableCaptionFlat} showTier />
      <RowsCards rows={rows} latest={latest} />
    </div>
  );
}

// Desktop (lg and up): a table; the whole row is the link.
function RowsTable({ rows, latest, caption, showTier = false }: RowsProps & { caption: string; showTier?: boolean }) {
  return (
    <div className="hidden overflow-hidden rounded-xl border bg-surface-raised lg:block">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {showTier ? <TableHead className="w-24 pl-4">{t.leaderboard.colTier}</TableHead> : null}
            <TableHead className={showTier ? undefined : "pl-4"}>{t.leaderboard.colStudent}</TableHead>
            <TableHead className="w-48 text-right">{t.leaderboard.colWorks}</TableHead>
            <TableHead className="w-36 pr-4 text-right">{t.leaderboard.colLastWork}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <DesktopRow key={row.student_id} row={row} lastWork={latest[row.student_id]} showTier={showTier} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DesktopRow({ row, lastWork, showTier }: { row: LeaderboardRow; lastWork?: string; showTier: boolean }) {
  return (
    // relative + the link's ::after make the whole row clickable.
    <TableRow className="relative hover:bg-primary-soft/50">
      {showTier ? (
        <TableCell className="pl-4">
          <TierBadge tier={row.tier} size="sm" />
        </TableCell>
      ) : null}
      <TableCell className={showTier ? "whitespace-normal" : "pl-4 whitespace-normal"}>
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
      <TableCell className="text-right tabular">{row.approved_count}</TableCell>
      <TableCell className="pr-4 text-right text-small text-muted-foreground tabular">
        {lastWork ? formatDate(lastWork) : "—"}
      </TableCell>
    </TableRow>
  );
}

// Phones and tablets: one card per student, tier badge first.
function RowsCards({ rows, latest }: RowsProps) {
  return (
    <ul className="grid gap-2 lg:hidden">
      {rows.map((row) => (
        <li key={row.student_id}>
          <MobileRow row={row} lastWork={latest[row.student_id]} />
        </li>
      ))}
    </ul>
  );
}

function MobileRow({ row, lastWork }: { row: LeaderboardRow; lastWork?: string }) {
  return (
    <Link href={`/students/${row.student_id}`} className={`block rounded-xl ${focusRing}`}>
      <Card interactive className="py-3">
        <CardContent className="flex items-center gap-3 px-3 sm:px-4">
          <TierBadge tier={row.tier} size="sm" />
          {/* No avatar on phones: the name needs the width. */}
          <StudentAvatar name={row.full_name} url={row.photo_url} className="max-sm:hidden" />
          <div className="grid min-w-0 flex-1">
            <span className="font-medium break-words">{row.full_name}</span>
            {row.faculty ? <span className="truncate text-small text-muted-foreground">{row.faculty}</span> : null}
            <span className="truncate text-xs text-muted-foreground tabular">
              {format(t.leaderboard.worksCount, { n: row.approved_count })}
              {lastWork ? ` · ${format(t.leaderboard.lastWork, { date: formatDate(lastWork) })}` : ""}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// Same shapes as LeaderboardRows while the data loads.
export function LeaderboardSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label={t.common.loading} className="grid gap-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-11 rounded-lg" />
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="hidden divide-y rounded-xl border bg-surface-raised lg:block">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-2 lg:hidden">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border bg-surface-raised p-3"
          >
            <Skeleton className="h-7 w-9 rounded-lg" />
            <Skeleton className="size-10 rounded-full max-sm:hidden" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

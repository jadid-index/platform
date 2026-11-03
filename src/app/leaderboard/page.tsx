import { Info, SearchX, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState as EmptyCard, ErrorState, SectionHeader, TierBadge } from "@/components/ds";
import { LeaderboardRows, LeaderboardSkeleton } from "@/components/leaderboard/leaderboard-rows";
import { LeaderboardShell } from "@/components/leaderboard/leaderboard-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { academicYearLabel, format, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import {
  getDefaultLeaderboard,
  getLatestWorkDates,
  getLeaderboard,
  getOwnStanding,
  getProfileAccess,
  getUniversitiesCached,
} from "@/lib/db";
import { DEFAULT_VIEW, parseView, type LeaderboardView } from "@/lib/leaderboard-view";
import type { Leaderboard, LeaderboardRow, LeaderboardYear, University } from "@/lib/types";

export const metadata: Metadata = { title: `${t.leaderboard.title} · ${t.common.appName}` };

const PAGE_SIZE = 50;

type Params = { year: LeaderboardYear | null; universityId?: number; facultyId?: number; query: string; limit: number; view: LeaderboardView };

function parseParams(sp: Record<string, string | string[] | undefined>): Params {
  const one = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : undefined);
  const int = (key: string) => {
    const n = Number(one(key));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const year = one("year");
  return {
    year: year === "all" ? "all" : (int("year") ?? null),
    universityId: int("university"),
    facultyId: int("faculty"),
    query: (one("q") ?? "").trim().slice(0, 100),
    limit: Math.min(int("limit") ?? PAGE_SIZE, 1000),
    view: parseView(sp.view),
  };
}

// Case- and apostrophe-insensitive, so "Gʻulom", "G'ulom" and "gulom" all match.
const normalize = (s: string) => s.toLocaleLowerCase("uz").replace(/[ʻʼ'`‘’]/g, "");

// Name search narrows the list; rows keep their tier.
function matchName(rows: LeaderboardRow[], query: string): LeaderboardRow[] {
  if (!query) return rows;
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    const name = normalize(row.full_name);
    return words.every((w) => name.includes(w));
  });
}

// Public leaderboard. No login needed.
export default function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader as="h1" title={t.leaderboard.title} description={t.leaderboard.description} />
      <p className="text-small text-muted-foreground">{t.tiers.explain}</p>
      <Suspense fallback={<LeaderboardSkeleton />}>
        <LeaderboardSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function LeaderboardSection({ searchParams }: { searchParams: PageProps<"/leaderboard">["searchParams"] }) {
  const params = parseParams(await searchParams);
  const filters = { university_id: params.universityId, faculty_id: params.facultyId };

  let board: Leaderboard;
  let universities: University[];
  let matched: LeaderboardRow[];
  let rows: LeaderboardRow[];
  let latest: Record<string, string>;
  try {
    [board, universities] = await Promise.all([
      params.year === null ? getDefaultLeaderboard(filters) : getLeaderboard({ ...filters, year: params.year }),
      getUniversitiesCached(),
    ]);
    matched = matchName(board.rows, params.query);
    rows = matched.slice(0, params.limit);
    latest = await getLatestWorkDates(
      rows.map((r) => r.student_id),
      board.academic_year,
    );
  } catch (error) {
    console.error("load leaderboard failed", error);
    return <ErrorState message={t.leaderboard.error} />;
  }

  const filtered = Boolean(filters.university_id || filters.faculty_id);

  return (
    <LeaderboardShell
      years={board.available_years}
      year={board.academic_year}
      universities={universities}
      universityId={params.universityId}
      facultyId={params.facultyId}
      query={params.query}
      view={params.view}
    >
      <div className="grid gap-3">
        {board.fallback_from_year !== null ? (
          <Alert className="border-status-pending-foreground/30 bg-status-pending text-status-pending-foreground">
            <Info aria-hidden />
            <AlertDescription className="text-status-pending-foreground">{t.leaderboard.fallbackNotice}</AlertDescription>
          </Alert>
        ) : null}
        <Suspense fallback={null}>
          <MyTier year={board.academic_year} />
        </Suspense>

        {rows.length === 0 ? (
          <EmptyState board={board} filtered={filtered} query={params.query} />
        ) : (
          <LeaderboardRows
            view={params.view}
            rows={rows}
            latest={latest}
            counts={params.view === "tiers" ? tierCounts(matched) : {}}
          />
        )}

        {matched.length > rows.length ? (
          <Button asChild variant="outline" size="lg">
            <Link href={moreHref(params, rows.length + PAGE_SIZE)} scroll={false}>
              {t.leaderboard.showMore}
            </Link>
          </Button>
        ) : null}
      </div>
    </LeaderboardShell>
  );
}

function moreHref(params: Params, limit: number): string {
  const qs = new URLSearchParams();
  if (params.year !== null) qs.set("year", String(params.year));
  if (params.universityId) qs.set("university", String(params.universityId));
  if (params.facultyId) qs.set("faculty", String(params.facultyId));
  if (params.query) qs.set("q", params.query);
  if (params.view !== DEFAULT_VIEW) qs.set("view", params.view);
  qs.set("limit", String(limit));
  return `/leaderboard?${qs}`;
}

function EmptyState({ board, filtered, query }: { board: Leaderboard; filtered: boolean; query: string }) {
  if (query && board.rows.length > 0) {
    return <EmptyCard icon={SearchX} text={format(t.leaderboard.emptySearch, { q: query })} />;
  }
  const text = filtered
    ? t.leaderboard.emptyFiltered
    : board.academic_year === "all"
      ? t.leaderboard.emptyAll
      : format(t.leaderboard.emptyYear, { year: academicYearLabel(board.academic_year) });
  return (
    <EmptyCard
      icon={Trophy}
      text={text}
      hint={!filtered && board.academic_year !== "all" ? t.leaderboard.emptyYearHint : undefined}
    />
  );
}

// Everyone per tier in the (searched) list, so a section shows its full size while only its first rows are loaded.
function tierCounts(rows: LeaderboardRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.tier?.code ?? ""] = (counts[r.tier?.code ?? ""] ?? 0) + 1;
  return counts;
}

// The signed-in student's own tier and exact points for the period shown. Only the owner sees this; the list
// itself never carries points. Filters do not change a tier, so they are ignored here.
async function MyTier({ year }: { year: LeaderboardYear }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const access = await getProfileAccess(user.id).catch(() => null);
  if (!access || access.role !== "student") return null;
  const mine = await getOwnStanding(user.id, year).catch(() => null);
  if (!mine) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-primary bg-primary-soft px-4 py-3 text-small" aria-live="polite">
      <TierBadge tier={mine.tier} />
      <p>
        <span className="font-semibold">{t.leaderboard.myTierTitle}: </span>
        {mine.points > 0 ? format(t.leaderboard.myTier, { points: mine.points }) : t.leaderboard.myTierNone}
      </p>
    </div>
  );
}

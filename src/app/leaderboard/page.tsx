import { Info, SearchX, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState as EmptyCard, ErrorState, SectionHeader } from "@/components/ds";
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
  getProfileAccess,
  getUniversitiesCached,
} from "@/lib/db";
import type { Leaderboard, LeaderboardRow, LeaderboardYear, University } from "@/lib/types";

export const metadata: Metadata = { title: `${t.leaderboard.title} · ${t.common.appName}` };

const PAGE_SIZE = 50;

type Params = { year: LeaderboardYear | null; universityId?: number; facultyId?: number; query: string; limit: number };

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
  };
}

// Case- and apostrophe-insensitive, so "Gʻulom", "G'ulom" and "gulom" all match.
const normalize = (s: string) => s.toLocaleLowerCase("uz").replace(/[ʻʼ'`‘’]/g, "");

// Name search narrows the ranked list; each row keeps its rank in the full list.
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
    >
      <div className="grid gap-3">
        {board.fallback_from_year !== null ? (
          <Alert className="border-status-pending-foreground/30 bg-status-pending text-status-pending-foreground">
            <Info aria-hidden />
            <AlertDescription className="text-status-pending-foreground">{t.leaderboard.fallbackNotice}</AlertDescription>
          </Alert>
        ) : null}
        <Suspense fallback={null}>
          <MyRank board={board} filtered={filtered} />
        </Suspense>

        {rows.length === 0 ? (
          <EmptyState board={board} filtered={filtered} query={params.query} />
        ) : (
          <LeaderboardRows rows={rows} latest={latest} />
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

// The signed-in student's own place in the list being shown (same year and filters).
async function MyRank({ board, filtered }: { board: Leaderboard; filtered: boolean }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const access = await getProfileAccess(user.id).catch(() => null);
  if (!access || access.role !== "student") return null;

  let text: string;
  const mine = board.rows.find((r) => r.student_id === user.id);
  if (mine) {
    text = format(t.leaderboard.myRank, { rank: mine.rank, points: mine.total_points });
  } else {
    // Not in the filtered list: show the place without filters, if the student has points this period.
    const unfiltered = filtered
      ? await getLeaderboard({ year: board.academic_year }).catch(() => null)
      : null;
    const overall = unfiltered?.rows.find((r) => r.student_id === user.id);
    text = overall
      ? format(t.leaderboard.myRankFiltered, { rank: overall.rank, points: overall.total_points })
      : t.leaderboard.myRankNone;
  }

  return (
    <div className="rounded-xl border border-primary bg-primary-soft px-4 py-3 text-small" aria-live="polite">
      <span className="font-semibold">{t.leaderboard.myRankTitle}: </span>
      {text}
    </div>
  );
}

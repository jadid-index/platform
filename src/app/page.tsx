import { Info, Trophy } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { Card, CardContent, EmptyState as EmptyCard, ErrorState, ListSkeleton, RankBadge } from "@/components/ds";
import { LeaderboardShell } from "@/components/leaderboard/leaderboard-shell";
import { StudentAvatar } from "@/components/student-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { academicYearLabel, format, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { getDefaultLeaderboard, getLeaderboard, getProfileAccess, getUniversitiesCached } from "@/lib/db";
import type { Leaderboard, LeaderboardYear, University } from "@/lib/types";

const PAGE_SIZE = 50;

type Params = { year: LeaderboardYear | null; universityId?: number; facultyId?: number; limit: number };

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
    limit: Math.min(int("limit") ?? PAGE_SIZE, 1000),
  };
}

// Public home page: the leaderboard. No login needed.
export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="grid gap-1">
        <h1 className="text-h1">{t.leaderboard.title}</h1>
        <p className="text-small text-muted-foreground">{t.home.tagline}</p>
      </header>
      <Suspense fallback={<ListSkeleton />}>
        <LeaderboardSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function LeaderboardSection({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const params = parseParams(await searchParams);
  const filters = { university_id: params.universityId, faculty_id: params.facultyId };

  let board: Leaderboard;
  let universities: University[];
  try {
    [board, universities] = await Promise.all([
      params.year === null ? getDefaultLeaderboard(filters) : getLeaderboard({ ...filters, year: params.year }),
      getUniversitiesCached(),
    ]);
  } catch (error) {
    console.error("load leaderboard failed", error);
    return <ErrorState message={t.leaderboard.error} />;
  }

  const filtered = Boolean(filters.university_id || filters.faculty_id);
  const rows = board.rows.slice(0, params.limit);

  return (
    <LeaderboardShell
      years={board.available_years}
      year={board.academic_year}
      universities={universities}
      universityId={params.universityId}
      facultyId={params.facultyId}
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
          <EmptyState board={board} filtered={filtered} />
        ) : (
          <ol className="grid gap-2">
            {rows.map((row) => (
              <li key={row.student_id}>
                <Link
                  href={`/students/${row.student_id}`}
                  className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Card interactive className="py-3">
                    <CardContent className="flex items-center gap-3 px-3 sm:px-4">
                      <RankBadge rank={row.rank} />
                      <StudentAvatar name={row.full_name} url={row.photo_url} />
                      <div className="grid min-w-0 flex-1">
                        <span className="truncate font-medium">{row.full_name}</span>
                        {row.faculty ? (
                          <span className="truncate text-small text-muted-foreground">{row.faculty}</span>
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
        )}

        {board.rows.length > rows.length ? (
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
  qs.set("limit", String(limit));
  return `/?${qs}`;
}

function EmptyState({ board, filtered }: { board: Leaderboard; filtered: boolean }) {
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

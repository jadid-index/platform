import { CheckCircle2, Plus, RotateCcw, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  CATEGORY_ORDER,
  CATEGORY_STYLES,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  ListSkeleton,
  SectionHeader,
  Skeleton,
  StatTile,
} from "@/components/ds";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { academicYearLabel, achievementTypeName, format, formatDate, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import {
  getCategoryProgress,
  getCurrentAcademicYear,
  getLeaderboard,
  getProfileSummary,
  getStudentYears,
  getYearPoints,
  listOwnSubmissions,
  type CategoryProgress,
  type ProfileSummary,
} from "@/lib/db";
import type { OwnSubmission } from "@/lib/types";
import { cn } from "@/lib/utils";

import { WithdrawButton } from "./withdraw-button";
import { YearTabs } from "./year-tabs";

export const metadata: Metadata = { title: `${t.dashboard.title} · ${t.common.appName}` };

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader as="h1" title={t.dashboard.title} />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// Desktop: stats and categories on the left, the list on the right. Phones: one column, stats first.
async function DashboardContent({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  // The proxy already redirects signed-out visitors; this is the authoritative check.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let profile: ProfileSummary | null;
  try {
    profile = await getProfileSummary(user.id);
  } catch (error) {
    console.error("load profile failed", error);
    return <ErrorState />;
  }
  if (!profile) redirect("/onboarding");
  const isStudent = profile.role === "student";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <aside className="grid gap-4 lg:sticky lg:top-24" aria-label={t.dashboard.categoriesTitle}>
        <Card className="gap-4 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-h2">{format(t.dashboard.greeting, { name: profile.full_name })}</CardTitle>
            <p className="text-small text-muted-foreground">
              {[profile.faculty, profile.course ? format(t.form.courseOption, { n: profile.course }) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </CardHeader>
          {isStudent ? (
            <CardContent className="px-5">
              <Button asChild size="lg" className="w-full">
                <Link href="/achievements/new">
                  <Plus aria-hidden />
                  {t.dashboard.addAchievement}
                </Link>
              </Button>
            </CardContent>
          ) : null}
        </Card>
        {isStudent ? (
          <Suspense fallback={<StatsSkeleton />}>
            <YearStats studentId={user.id} searchParams={searchParams} />
          </Suspense>
        ) : null}
      </aside>

      <section className="grid gap-3" aria-labelledby="my-submissions">
        <SectionHeader id="my-submissions" title={t.dashboard.mySubmissions} />
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <SubmissionList studentId={user.id} canResubmit={isStudent} />
        </Suspense>
      </section>
    </div>
  );
}

// Points total, rank and per-category progress for one academic year. All numbers are read as stored:
// totals and rank from the leaderboard views, category points from the approved reviews.
async function YearStats({
  studentId,
  searchParams,
}: {
  studentId: string;
  searchParams: PageProps<"/dashboard">["searchParams"];
}) {
  let years: number[];
  let year: number;
  let points: number;
  let rank: number | null;
  let categories: CategoryProgress[];
  try {
    const [current, ownYears, sp] = await Promise.all([
      getCurrentAcademicYear(),
      getStudentYears(studentId),
      searchParams,
    ]);
    years = [...new Set([current, ...ownYears])].sort((a, b) => b - a);
    const asked = Number(sp.year);
    year = years.includes(asked) ? asked : current;
    const [yearPoints, board, progress] = await Promise.all([
      getYearPoints(studentId, year),
      getLeaderboard({ year }),
      getCategoryProgress(studentId, year),
    ]);
    points = yearPoints;
    rank = board.rows.find((r) => r.student_id === studentId)?.rank ?? null;
    categories = progress;
  } catch (error) {
    console.error("load dashboard stats failed", error);
    return <ErrorState message={t.dashboard.statsError} />;
  }

  const byCode = new Map(categories.map((c) => [c.code, c]));
  const ordered = [
    ...CATEGORY_ORDER.flatMap((code) => byCode.get(code) ?? []),
    ...categories.filter((c) => !CATEGORY_ORDER.includes(c.code)),
  ];
  const yearLabel = academicYearLabel(year);

  return (
    <Card className="gap-4 py-5">
      <CardContent className="grid gap-5 px-5">
        {years.length > 1 ? <YearTabs years={years} year={year} /> : null}
        {/* The total matches this year's leaderboard tab, so the rank is the place shown there. */}
        <dl className="grid grid-cols-2 gap-3">
          <StatTile
            emphasis
            label={t.dashboard.yearTotal}
            value={points}
            unit={t.dashboard.pointsUnit}
            hint={yearLabel}
            className="p-3"
          />
          <StatTile
            label={t.dashboard.rank}
            value={rank ? format(t.dashboard.rankValue, { rank }) : t.dashboard.rankNone}
            hint={format(t.dashboard.rankHint, { year: yearLabel })}
            className="p-3"
          />
        </dl>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 className="text-body font-semibold">{t.dashboard.categoriesTitle}</h2>
            <p className="text-small text-muted-foreground">{t.dashboard.categoriesHint}</p>
          </div>
          <ul className="grid gap-3">
            {ordered.map((c) => (
              <CategoryBar key={c.code} progress={c} />
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryBar({ progress: { code, points, cap } }: { progress: CategoryProgress }) {
  const style = CATEGORY_STYLES[code] ?? { fill: "bg-muted", ink: "text-foreground", bar: "bg-primary-strong" };
  const name = t.categories[code] ?? code;
  const label = format(t.dashboard.categoryProgress, { points, cap });
  const full = cap > 0 && points >= cap;
  return (
    <li className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-small">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground tabular">{label}</span>
      </div>
      <Progress
        value={cap > 0 ? Math.min(100, (points / cap) * 100) : 0}
        aria-valuetext={label}
        aria-label={name}
        className={cn("h-2.5", style.fill)}
        indicatorClassName={style.bar}
      />
      {full ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-status-approved-foreground">
          <CheckCircle2 className="size-3.5" aria-hidden />
          {t.dashboard.capReached}
        </span>
      ) : null}
    </li>
  );
}

async function SubmissionList({ studentId, canResubmit }: { studentId: string; canResubmit: boolean }) {
  let submissions: OwnSubmission[];
  try {
    submissions = await listOwnSubmissions(studentId);
  } catch (error) {
    console.error("load submissions failed", error);
    return <ErrorState message={t.dashboard.loadError} />;
  }

  if (submissions.length === 0) {
    return (
      <EmptyState
        text={t.dashboard.empty}
        action={
          canResubmit ? (
            <Button asChild variant="outline" size="lg">
              <Link href="/achievements/new">
                <Plus aria-hidden />
                {t.dashboard.addAchievement}
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <ul className="grid gap-3">
      {submissions.map((s) => (
        <li key={s.id}>
          <Card className="gap-3 py-4">
            <CardContent className="grid gap-2 px-4 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <StatusBadge status={s.status} />
                {s.status === "approved" && s.points_awarded !== null ? (
                  <span className="text-small font-semibold text-primary-strong tabular">
                    {format(t.dashboard.pointsAwarded, { points: s.points_awarded })}
                  </span>
                ) : null}
              </div>
              <p className="font-medium break-words">{s.title}</p>
              <p className="text-small text-muted-foreground">
                {achievementTypeName(s.type_id, s.type_name)} · {t.levels[s.level]}
                {s.result !== "confirmed" ? ` · ${t.results[s.result]}` : ""}
              </p>
              <p className="text-small text-muted-foreground tabular">
                {format(t.dashboard.achievedOn, { date: formatDate(s.achievement_date) })} ·{" "}
                {format(t.dashboard.submittedOn, { date: formatDate(s.submitted_at) })}
              </p>
              {s.status === "rejected" ? (
                <div className="grid gap-3 rounded-lg border border-status-rejected-foreground/20 bg-status-rejected p-3 text-small text-status-rejected-foreground">
                  {s.rejection_reason ? (
                    <div className="flex items-start gap-2">
                      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <div className="grid gap-0.5">
                        <p className="font-semibold">{t.dashboard.rejectionReason}</p>
                        <p className="break-words whitespace-pre-line">{s.rejection_reason}</p>
                      </div>
                    </div>
                  ) : null}
                  {canResubmit ? (
                    <Button asChild variant="outline" size="sm" className="w-fit">
                      <Link href={`/achievements/new?resubmit=${s.id}`}>
                        <RotateCcw aria-hidden />
                        {t.dashboard.resubmit}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {s.status === "pending" ? <WithdrawButton submissionId={s.id} /> : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function StatsSkeleton() {
  return (
    <div role="status" aria-label={t.common.loading} className="grid gap-4 rounded-xl border bg-surface-raised p-5">
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="grid gap-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-2.5 w-full" />
        </div>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Skeleton className="h-36 rounded-xl" />
        <StatsSkeleton />
      </div>
      <ListSkeleton rows={3} />
    </div>
  );
}

import { ArrowRight, CheckCircle2, Handshake, Plus, RotateCcw, XCircle } from "lucide-react";
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
  TierBadge,
} from "@/components/ds";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { academicYearLabel, typeName, format, formatDate, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import {
  countPendingContactRequests,
  getProfileAccess,
  getCategoryProgress,
  getCurrentAcademicYear,
  getOwnStanding,
  getProfileSummary,
  getStudentYears,
  listOwnSubmissions,
  listTiers,
  type CategoryProgress,
  type ProfileSummary,
} from "@/lib/db";
import type { OwnSubmission, PublicTier, Tier } from "@/lib/types";
import { cn } from "@/lib/utils";

import { FileVisibilityControl } from "./file-visibility-control";
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
  let active: boolean;
  try {
    const [summary, access] = await Promise.all([getProfileSummary(user.id), getProfileAccess(user.id)]);
    profile = summary;
    active = access?.status === "active";
  } catch (error) {
    console.error("load profile failed", error);
    return <ErrorState />;
  }
  if (!profile) redirect("/onboarding");
  // Employers have no submissions; their home is the talent directory. A hidden employer stays here
  // (the /talent gate would send them back, so no redirect loop).
  if (profile.role === "employer" && active) redirect("/talent");
  const isStudent = profile.role === "student";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <aside className="grid gap-4 lg:sticky lg:top-(--nav-offset)" aria-label={t.dashboard.categoriesTitle}>
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

      <div className="grid content-start gap-6">
        {isStudent && active ? (
          <Suspense fallback={null}>
            <OffersNudge studentId={user.id} />
          </Suspense>
        ) : null}
        <section className="grid gap-3" aria-labelledby="my-submissions">
          <SectionHeader id="my-submissions" title={t.dashboard.mySubmissions} />
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <SubmissionList studentId={user.id} canResubmit={isStudent} />
          </Suspense>
        </section>
      </div>
    </div>
  );
}

// New contact requests live on /offers; a link here so a student opening the dashboard does not miss them.
async function OffersNudge({ studentId }: { studentId: string }) {
  let pending: number;
  try {
    pending = await countPendingContactRequests(studentId);
  } catch (error) {
    console.error("count contact requests failed", error);
    return null;
  }
  if (pending === 0) return null;
  return (
    <Link
      href="/offers"
      className="flex items-center gap-3 rounded-2xl border border-primary bg-primary-soft p-4 outline-none transition-shadow hover:shadow-card focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-contrast">
        <Handshake className="size-5" aria-hidden />
      </span>
      <span className="grid flex-1 gap-0.5">
        <span className="font-semibold">{format(t.offers.nudge, { n: pending })}</span>
        <span className="text-small text-primary-text">{t.offers.nudgeAction}</span>
      </span>
      <ArrowRight className="size-5 shrink-0" aria-hidden />
    </Link>
  );
}

// The student's own exact points, own tier and per-category progress for one academic year, read from the
// approved reviews. Only the owner sees the points; the public sees the tier. There is no rank.
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
  let tier: PublicTier | null;
  let next: Tier | null;
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
    const [standing, tiers, progress] = await Promise.all([
      getOwnStanding(studentId, year),
      listTiers(),
      getCategoryProgress(studentId, year),
    ]);
    points = standing.points;
    tier = standing.tier;
    // The next better tier: the lowest threshold above the current points.
    next = [...tiers].sort((a, b) => a.min_points - b.min_points).find((x) => x.min_points > points) ?? null;
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
        {/* The tier matches this year's leaderboard tab; the points are shown to the owner only. */}
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
            label={t.dashboard.tier}
            value={tier ? <TierBadge tier={tier} /> : t.dashboard.tierNone}
            hint={
              next
                ? format(t.dashboard.nextTier, { tier: typeName(next.label), n: next.min_points - points })
                : format(t.dashboard.tierHint, { year: yearLabel })
            }
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
                {typeName(s.type_name)} · {t.levels[s.level]}
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
              {s.status === "approved" ? (
                <>
                  <Link
                    href={`/works/${s.id}`}
                    className="w-fit text-small font-medium text-primary-text underline-offset-4 hover:underline"
                  >
                    {t.dashboard.viewWork}
                  </Link>
                  <FileVisibilityControl submissionId={s.id} initial={s.file_visibility} locked={s.sensitive_data_flag} />
                </>
              ) : null}
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

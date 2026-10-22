import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { academicYearLabel, achievementTypeName, format, formatDate, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import {
  getCurrentAcademicYear,
  getProfileSummary,
  getTotalPoints,
  getYearPoints,
  listOwnSubmissions,
  type ProfileSummary,
} from "@/lib/db";
import type { OwnSubmission } from "@/lib/types";

import { LogoutButton } from "./logout-button";
import { ReviewLink } from "./review-link";
import { WithdrawButton } from "./withdraw-button";

export const metadata: Metadata = { title: `${t.dashboard.title} · ${t.common.appName}` };

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t.dashboard.title}</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Suspense fallback={null}>
            <ReviewLink />
          </Suspense>
          <LogoutButton />
        </div>
      </header>
      <Suspense fallback={<LoadingState />}>
        <DashboardContent />
      </Suspense>
    </main>
  );
}

async function DashboardContent() {
  // The proxy already redirects signed-out visitors; this is the authoritative check.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let profile: ProfileSummary | null;
  let totalPoints: number;
  let currentYear: number;
  let yearPoints: number;
  try {
    [profile, totalPoints, currentYear] = await Promise.all([
      getProfileSummary(user.id),
      getTotalPoints(user.id),
      getCurrentAcademicYear(),
    ]);
    yearPoints = await getYearPoints(user.id, currentYear);
  } catch (error) {
    console.error("load profile failed", error);
    return <ErrorState />;
  }
  if (!profile) redirect("/onboarding");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{format(t.dashboard.greeting, { name: profile.full_name })}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {[profile.faculty, profile.course ? format(t.form.courseOption, { n: profile.course }) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-4">
          {/* This year's points match the default leaderboard tab; the all-time total matches "Barcha yillar". */}
          <dl className="flex gap-6">
            <div>
              <dt className="text-sm text-muted-foreground">
                {format(t.dashboard.yearPoints, { year: academicYearLabel(currentYear) })}
              </dt>
              <dd className="text-4xl font-semibold text-primary-strong">
                {yearPoints}{" "}
                <span className="text-base font-normal text-muted-foreground">{t.dashboard.pointsUnit}</span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t.dashboard.allTimePoints}</dt>
              <dd className="text-4xl font-semibold">
                {totalPoints}{" "}
                <span className="text-base font-normal text-muted-foreground">{t.dashboard.pointsUnit}</span>
              </dd>
            </div>
          </dl>
          {profile.role === "student" ? (
            <Button asChild size="lg">
              <Link href="/achievements/new">
                <Plus aria-hidden />
                {t.dashboard.addAchievement}
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-3" aria-labelledby="my-submissions">
        <h2 id="my-submissions" className="text-lg font-semibold">
          {t.dashboard.mySubmissions}
        </h2>
        <Suspense fallback={<LoadingState />}>
          <SubmissionList studentId={user.id} />
        </Suspense>
      </section>
    </>
  );
}

async function SubmissionList({ studentId }: { studentId: string }) {
  let submissions: OwnSubmission[];
  try {
    submissions = await listOwnSubmissions(studentId);
  } catch (error) {
    console.error("load submissions failed", error);
    return <ErrorState message={t.dashboard.loadError} />;
  }

  if (submissions.length === 0) {
    return (
      <Card>
        <CardContent className="grid gap-4 py-2 text-center">
          <p className="text-muted-foreground">{t.dashboard.empty}</p>
          <Button asChild variant="outline" size="lg">
            <Link href="/achievements/new">
              <Plus aria-hidden />
              {t.dashboard.addAchievement}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="grid gap-3">
      {submissions.map((s) => (
        <li key={s.id}>
          <Card className="gap-3 py-4">
            <CardContent className="grid gap-2 px-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <StatusBadge status={s.status} />
                {s.status === "approved" && s.points_awarded !== null ? (
                  <span className="text-sm font-semibold text-primary-strong">
                    {format(t.dashboard.pointsAwarded, { points: s.points_awarded })}
                  </span>
                ) : null}
              </div>
              <p className="font-medium break-words">{s.title}</p>
              <p className="text-sm text-muted-foreground">
                {achievementTypeName(s.type_id, s.type_name)} · {t.levels[s.level]}
                {s.result !== "confirmed" ? ` · ${t.results[s.result]}` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                {format(t.dashboard.achievedOn, { date: formatDate(s.achievement_date) })} ·{" "}
                {format(t.dashboard.submittedOn, { date: formatDate(s.submitted_at) })}
              </p>
              {s.status === "rejected" && s.rejection_reason ? (
                <div className="rounded-md bg-status-rejected p-3 text-sm text-status-rejected-foreground">
                  <p className="font-semibold">{t.dashboard.rejectionReason}</p>
                  <p className="break-words whitespace-pre-line">{s.rejection_reason}</p>
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

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { Card, CardContent, EmptyState, ErrorState, SectionHeader, TierBadge } from "@/components/ds";
import { LoadingState } from "@/components/loading-state";
import { StudentAvatar } from "@/components/student-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { academicYearLabel, format, formatDate, t, typeName } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { getProfileAccess, getPublicStudent, logEmployerProfileView } from "@/lib/db";
import type { PublicStudent } from "@/lib/types";

export const metadata: Metadata = { title: `${t.leaderboard.title} · ${t.common.appName}` };

// Public profile: name, faculty, tier and approved works (each links to its work page). Never points or files.
export default function StudentPage({ params }: PageProps<"/students/[id]">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link href="/leaderboard" className="w-fit text-sm text-primary-strong underline-offset-4 hover:underline">
        ← {t.leaderboard.back}
      </Link>
      <Suspense fallback={<LoadingState />}>
        <StudentLoader params={params} />
      </Suspense>
    </div>
  );
}

async function StudentLoader({ params }: { params: PageProps<"/students/[id]">["params"] }) {
  const id = z.uuid().safeParse((await params).id);

  let student: PublicStudent | null = null;
  if (id.success) {
    try {
      student = await getPublicStudent(id.data);
    } catch (error) {
      console.error("load public student failed", error);
      return <ErrorState message={t.leaderboard.studentError} />;
    }
  }
  if (student) await logIfEmployer(student.student_id);
  if (!student) {
    return (
      <Alert>
        <AlertDescription>{t.leaderboard.studentNotFound}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card className="py-4">
        <CardContent className="flex items-center gap-4 px-4">
          <StudentAvatar name={student.full_name} url={student.photo_url} className="size-16 text-lg" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <h1 className="text-h2 break-words">{student.full_name}</h1>
            <p className="text-sm text-muted-foreground">
              {[student.faculty, student.university].filter(Boolean).join(" · ")}
            </p>
            <p className="text-sm text-muted-foreground">{format(t.leaderboard.worksCount, { n: student.approved_count })}</p>
          </div>
        </CardContent>
      </Card>

      {/* Tiers only: the headline is the best academic year (as on the all-time tab), plus this year's tier. */}
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4">
          <div className="flex items-center gap-3">
            <TierBadge tier={student.tier} size="lg" />
            <p className="text-small font-medium">{t.leaderboard.profileTierAllTime}</p>
          </div>
          <div className="flex items-center gap-2">
            <TierBadge tier={student.current_year.tier} size="sm" />
            <p className="text-small text-muted-foreground">
              {format(t.leaderboard.profileTierYear, { year: academicYearLabel(student.current_year.academic_year) })}
            </p>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3" aria-labelledby="works-title">
        <SectionHeader id="works-title" title={t.leaderboard.worksTitle} />
        {student.works.length === 0 ? (
          <EmptyState text={t.leaderboard.noWorks} />
        ) : (
          <ul className="grid gap-2">
            {student.works.map((w) => (
              <li key={w.submission_id}>
                <Card className="py-3">
                  <CardContent className="grid gap-1 px-4">
                    <Link
                      href={`/works/${w.submission_id}`}
                      className="font-medium break-words underline-offset-4 hover:text-primary-text hover:underline"
                    >
                      {w.title}
                    </Link>
                    <p className="text-sm text-muted-foreground break-words">{w.issuer}</p>
                    <p className="text-sm text-muted-foreground">
                      {typeName(w.type_name)} · {t.levels[w.level]}
                      {w.result !== "confirmed" ? ` · ${t.results[w.result]}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">{formatDate(w.achievement_date)}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// Each view of a student profile by an active employer goes to audit_log (employer, student, time).
// A logging failure never blocks the public page.
async function logIfEmployer(studentId: string): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const access = await getProfileAccess(user.id);
    if (access?.role === "employer" && access.status === "active") {
      await logEmployerProfileView(user.id, studentId, "public_profile");
    }
  } catch (error) {
    console.error("log employer profile view failed", error);
  }
}

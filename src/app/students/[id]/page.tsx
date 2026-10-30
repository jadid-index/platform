import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { Card, CardContent, EmptyState, ErrorState, SectionHeader } from "@/components/ds";
import { LoadingState } from "@/components/loading-state";
import { StudentAvatar } from "@/components/student-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { achievementTypeName, format, formatDate, t } from "@/i18n";
import { getPublicStudent } from "@/lib/db";
import type { PublicStudent } from "@/lib/types";

export const metadata: Metadata = { title: `${t.leaderboard.title} · ${t.common.appName}` };

// Public profile: name, faculty, score and approved works. Never files.
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
            <p className="text-sm">
              {t.leaderboard.totalAllTime}:{" "}
              <span className="font-semibold text-primary-strong tabular">
                {format(t.leaderboard.points, { points: student.total_points })}
              </span>
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
            {student.works.map((w, i) => (
              <li key={`${w.title}-${w.achievement_date}-${i}`}>
                <Card className="py-3">
                  <CardContent className="grid gap-1 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium break-words">{w.title}</p>
                      <span className="shrink-0 font-semibold text-primary-strong tabular">+{w.points_awarded}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {w.type_id ? achievementTypeName(w.type_id, w.type_name) : w.type_name} · {t.levels[w.level]}
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

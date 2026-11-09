import { FileUser } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, SectionHeader, TierBadge } from "@/components/ds";
import { CvFileLink } from "@/components/cv/cv-file-link";
import { LoadingState } from "@/components/loading-state";
import { checkTalentPage } from "@/components/talent-gate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format, formatDate, t, typeName } from "@/i18n";
import { getEmployerProfile } from "@/lib/db";
import { fileHref } from "@/lib/file-access";
import { loadTalentStudent } from "@/lib/talent";
import type { EmployerRequestState, TalentStudent } from "@/lib/types";

import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: `${t.talent.title} · ${t.common.appName}`, robots: { index: false } };

// One open-to-work student for an employer or admin. Each employer view is logged in audit_log.
export default function TalentStudentPage({ params }: PageProps<"/talent/[studentId]">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link href="/talent" className="w-fit text-sm text-primary-text underline-offset-4 hover:underline">
        {t.talent.back}
      </Link>
      <Suspense fallback={<LoadingState />}>
        <StudentLoader params={params} />
      </Suspense>
    </div>
  );
}

async function StudentLoader({ params }: { params: PageProps<"/talent/[studentId]">["params"] }) {
  const viewer = await checkTalentPage();
  const id = z.uuid().safeParse((await params).studentId);

  let student: TalentStudent | null = null;
  let hasCompany = true;
  if (id.success) {
    try {
      const [s, company] = await Promise.all([
        loadTalentStudent(viewer, id.data),
        viewer.role === "employer" ? getEmployerProfile(viewer.userId) : Promise.resolve(null),
      ]);
      student = s;
      hasCompany = viewer.role !== "employer" || !!company?.company_name;
    } catch (error) {
      console.error("load talent student failed", error);
      return <ErrorState message={t.talent.studentError} />;
    }
  }
  if (!student) {
    return (
      <Alert>
        <AlertDescription>{t.talent.notFound}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <Card className="py-4">
        <CardContent className="flex items-center gap-4 px-4">
          <TierBadge tier={student.tier} size="lg" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <h1 className="text-h2 break-words">{student.full_name}</h1>
            <p className="text-sm text-muted-foreground">{[student.faculty, student.university].filter(Boolean).join(" · ")}</p>
            <p className="text-sm text-muted-foreground">{format(t.talent.works, { n: student.approved_count })}</p>
            {student.cv_available || student.cv_file_available ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {student.cv_available ? (
                  <Link
                    href={`/cv/${student.student_id}`}
                    className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary-text underline-offset-4 hover:underline"
                  >
                    <FileUser className="size-4" aria-hidden />
                    {t.talent.openCv}
                  </Link>
                ) : null}
                {student.cv_file_available ? <CvFileLink studentId={student.student_id} size="sm" /> : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {viewer.role === "employer" ? (
        <Card className="gap-3 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-h2">{t.talent.requestTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 px-5">
            <RequestState request={student.request} studentId={student.student_id} hasCompany={hasCompany} />
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <AlertDescription>{t.talent.adminNote}</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-3" aria-labelledby="works-title">
        <SectionHeader id="works-title" title={t.talent.worksTitle} />
        {student.works.length === 0 ? (
          <EmptyState text={t.talent.noWorks} />
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
                    {w.can_view_file ? (
                      <a
                        href={fileHref(w.submission_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-fit text-sm font-medium text-primary-text underline-offset-4 hover:underline"
                      >
                        {t.files.viewDocument}
                      </a>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t.talent.noDocument}</p>
                    )}
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

function RequestState({
  request,
  studentId,
  hasCompany,
}: {
  request: EmployerRequestState | null;
  studentId: string;
  hasCompany: boolean;
}) {
  if (!hasCompany) return <p className="text-small text-muted-foreground">{t.talent.missingCompany}</p>;
  if (request?.status === "pending") return <p className="text-small">{t.talent.pending}</p>;
  if (request?.status === "accepted") {
    return (
      <div className="grid gap-1">
        <p className="text-small text-primary-text">{t.talent.accepted}</p>
        {request.shared_contact ? (
          <p className="font-medium break-all">
            {t.talent.contactKinds[request.shared_contact.kind]}: {request.shared_contact.value}
          </p>
        ) : null}
      </div>
    );
  }
  const coolingDown = request?.status === "declined" && request.resend_after && new Date(request.resend_after) > new Date();
  if (coolingDown) {
    return <p className="text-small">{format(t.talent.declined, { date: formatDate(request.resend_after!) })}</p>;
  }
  return (
    <>
      <p className="text-small text-muted-foreground">
        {request?.status === "declined" ? t.talent.declinedCanResend : t.talent.requestHint}
      </p>
      <RequestForm studentId={studentId} />
    </>
  );
}

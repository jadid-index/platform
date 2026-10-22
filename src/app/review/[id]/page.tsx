import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { checkReviewerPage } from "@/components/reviewer-gate";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { achievementTypeName, format, formatAge, formatDate, t } from "@/i18n";
import { createProofReadUrl, getMeta, getPointsPreview, getSubmissionForReview } from "@/lib/db";
import type { Meta, PointsPreview, SubmissionForReview } from "@/lib/types";

import { ReviewPanel } from "./review-panel";

export const metadata: Metadata = { title: `${t.review.title} · ${t.common.appName}` };

// Signed URLs for proofs are short-lived on purpose.
const FILE_URL_MINUTES = 10;

export default function ReviewSubmissionPage({ params }: PageProps<"/review/[id]">) {
  return (
    <main className="grid gap-4">
      <Link href="/review" className="w-fit text-sm text-primary-strong underline-offset-4 hover:underline">
        ← {t.review.backToQueue}
      </Link>
      <Suspense fallback={<LoadingState />}>
        <ReviewLoader params={params} />
      </Suspense>
    </main>
  );
}

async function ReviewLoader({ params }: { params: PageProps<"/review/[id]">["params"] }) {
  const access = await checkReviewerPage();
  if ("denied" in access) return access.denied;

  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return <Notice text={t.review.notFound} />;

  let submission: SubmissionForReview | null;
  let meta: Meta;
  try {
    [submission, meta] = await Promise.all([getSubmissionForReview(id.data), getMeta()]);
  } catch (error) {
    console.error("load review failed", error);
    return <ErrorState message={t.review.loadError} />;
  }
  if (!submission) return <Notice text={t.review.notFound} />;
  if (submission.status !== "pending") {
    return <Notice text={format(t.review.notPending, { status: t.status[submission.status] })} />;
  }

  let fileUrl: string | null = null;
  try {
    fileUrl = await createProofReadUrl(submission.file_path, FILE_URL_MINUTES * 60);
  } catch (error) {
    console.error("signed url failed", error);
  }

  let preview: PointsPreview | null = null;
  try {
    preview = await getPointsPreview(submission.id, submission.type_id, submission.level, submission.result);
  } catch (error) {
    console.error("points preview failed", error);
  }

  const isOwn = submission.student.id === access.reviewerId;

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <section className="lg:sticky lg:top-4" aria-labelledby="proof-title">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle id="proof-title">{t.review.file}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 px-4">
            {fileUrl ? <ProofViewer url={fileUrl} path={submission.file_path} /> : <ErrorState message={t.review.fileError} />}
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-4">
        <SubmittedData
          submission={submission}
          typeName={meta.achievement_types.find((x) => x.id === submission.type_id)?.name ?? ""}
        />
        {isOwn ? (
          <Alert variant="destructive">
            <AlertDescription>{t.review.selfReview}</AlertDescription>
          </Alert>
        ) : null}
        <ReviewPanel
          submissionId={submission.id}
          types={meta.achievement_types}
          rubric={meta.rubric_points}
          initial={{ typeId: String(submission.type_id), level: submission.level, result: submission.result }}
          initialPreview={preview}
          disabled={isOwn}
        />
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <Alert>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

function ProofViewer({ url, path }: { url: string; path: string }) {
  const isPdf = path.toLowerCase().endsWith(".pdf");
  return (
    <>
      {isPdf ? (
        // Some phone browsers do not render PDFs inline; the link below always works.
        <iframe src={url} title={t.review.file} className="h-[60vh] w-full rounded-md border bg-muted lg:h-[75vh]" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, not an optimizable static asset
        <img src={url} alt={t.review.file} className="max-h-[75vh] w-full rounded-md border object-contain" />
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary-strong underline-offset-4 hover:underline"
      >
        <ExternalLink className="size-4" aria-hidden />
        {t.review.openFile}
      </a>
      <p className="text-xs text-muted-foreground">
        {format(t.review.fileLinkExpiry, { minutes: FILE_URL_MINUTES })}
      </p>
    </>
  );
}

function SubmittedData({ submission: s, typeName }: { submission: SubmissionForReview; typeName: string }) {
  const ref = s.certificate_ref;
  const rows: [string, React.ReactNode][] = [
    [
      t.review.student,
      [s.student.full_name, s.student.faculty, s.student.course ? format(t.form.courseOption, { n: s.student.course }) : null]
        .filter(Boolean)
        .join(" · "),
    ],
    [t.review.type, achievementTypeName(s.type_id, typeName)],
    [t.review.level, t.levels[s.level]],
    ...(s.result !== "confirmed" ? [[t.review.result, t.results[s.result]] as [string, React.ReactNode]] : []),
    [t.review.titleField, s.title],
    [t.review.issuer, s.issuer],
    [t.review.date, formatDate(s.achievement_date)],
    [
      t.review.certificateRef,
      ref ? (
        /^https?:\/\//i.test(ref) ? (
          <a href={ref} target="_blank" rel="noopener noreferrer" className="break-all text-primary-strong underline">
            {ref}
          </a>
        ) : (
          ref
        )
      ) : (
        t.review.none
      ),
    ],
    [t.review.note, s.note ?? t.review.none],
    [t.review.submittedAt, `${formatDate(s.submitted_at)} (${formatAge(s.submitted_at)})`],
  ];
  if (s.parent_id) rows.push([t.review.studentComment, s.student_comment ?? t.review.none]);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
        <CardTitle>{t.review.submitted}</CardTitle>
        <StatusBadge status={s.status} />
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        {s.parent_id ? <p className="text-sm text-muted-foreground">{t.review.resubmission}</p> : null}
        <dl className="grid gap-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-0.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words whitespace-pre-line">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

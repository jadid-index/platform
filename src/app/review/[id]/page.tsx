import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { checkReviewerPage } from "@/components/reviewer-gate";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ds";
import { achievementTypeName, format, formatAge, formatDate, t } from "@/i18n";
import {
  createProofReadUrl,
  findLiveDuplicates,
  getMeta,
  getPointsPreview,
  getSubmissionForReview,
  type LiveDuplicate,
} from "@/lib/db";
import { recognitionChecks, type Check } from "@/lib/recognition";
import type { Meta, PointsPreview, SubmissionForReview } from "@/lib/types";

import { ReviewPanel } from "./review-panel";

export const metadata: Metadata = { title: `${t.review.title} · ${t.common.appName}` };

// Signed URLs for proofs are short-lived on purpose.
const FILE_URL_MINUTES = 10;

export default function ReviewSubmissionPage({ params }: PageProps<"/review/[id]">) {
  return (
    <div className="grid gap-4">
      <Link href="/review" className="w-fit text-sm text-primary-strong underline-offset-4 hover:underline">
        ← {t.review.backToQueue}
      </Link>
      <Suspense fallback={<LoadingState />}>
        <ReviewLoader params={params} />
      </Suspense>
    </div>
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

  // Recognition check (SPEC section 5): code comparisons, shown for information only.
  const checks = recognitionChecks(submission.ai_extraction as Parameters<typeof recognitionChecks>[0], {
    profile_name: submission.student.full_name,
    achievement_date: submission.achievement_date,
    certificate_ref: submission.certificate_ref,
  });
  let duplicates: LiveDuplicate[] | null = null;
  try {
    duplicates = await findLiveDuplicates({ ...submission, student_id: submission.student.id });
  } catch (error) {
    console.error("duplicate check failed", error);
  }

  // Desktop: the proof on the left (kept in view while scrolling), everything to decide with on the right.
  // Phones: stacked, file first.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-6">
      <section className="lg:sticky lg:top-24" aria-labelledby="proof-title">
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
        <RecognitionCard extraction={submission.ai_extraction} checks={checks} duplicates={duplicates} />
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
        <iframe
          src={url}
          title={t.review.file}
          className="h-[60vh] w-full rounded-md border bg-muted lg:h-[calc(100vh-15rem)]"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, not an optimizable static asset
        <img
          src={url}
          alt={t.review.file}
          className="max-h-[60vh] w-full rounded-md border object-contain lg:max-h-[calc(100vh-15rem)]"
        />
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

const CHECK_LABEL: Record<Check["key"], string> = {
  name: t.review.checkName,
  date: t.review.checkDate,
  certificate_ref: t.review.checkRef,
};

// Every status shows an icon and a word, never colour alone.
function CheckStatusLabel({ status }: { status: Check["status"] }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-approved px-2 py-0.5 text-xs font-medium text-status-approved-foreground">
        <CheckCircle2 className="size-3.5" aria-hidden />
        {t.review.checkOk}
      </span>
    );
  }
  if (status === "check") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-pending px-2 py-0.5 text-xs font-medium text-status-pending-foreground">
        <AlertTriangle className="size-3.5" aria-hidden />
        {t.review.checkCheck}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <HelpCircle className="size-3.5" aria-hidden />
      {t.review.checkMissing}
    </span>
  );
}

function RecognitionCard({
  extraction,
  checks,
  duplicates,
}: {
  extraction: unknown;
  checks: Check[];
  duplicates: LiveDuplicate[] | null;
}) {
  const ai = (extraction ?? null) as { document_kind?: string; confidence?: string; warnings?: string[] } | null;
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle>{t.review.recognitionTitle}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 px-4 text-sm">
        <p className="text-muted-foreground">{t.review.recognitionHint}</p>
        {ai ? (
          <ul className="grid gap-3">
            {checks.map((c) => (
              <li key={c.key} className="grid gap-1 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{CHECK_LABEL[c.key]}</span>
                  <CheckStatusLabel status={c.status} />
                </div>
                <dl className="grid gap-1 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t.review.onDocument}</dt>
                    <dd className="break-words">{c.document ?? t.review.none}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{c.key === "name" ? t.review.profileName : t.review.entered}</dt>
                    <dd className="break-words">
                      {c.entered ? (c.key === "date" ? formatDate(c.entered) : c.entered) : t.review.none}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md bg-muted p-3 text-muted-foreground">{t.review.recognitionNoData}</p>
        )}

        <div className="grid gap-2">
          <h3 className="font-medium">{t.review.duplicatesTitle}</h3>
          {duplicates === null ? (
            <p className="text-muted-foreground">{t.common.genericError}</p>
          ) : duplicates.length === 0 ? (
            <p className="inline-flex items-center gap-1 text-muted-foreground">
              <CheckCircle2 className="size-4" aria-hidden />
              {t.review.noDuplicates}
            </p>
          ) : (
            <ul className="grid gap-2">
              {duplicates.map((d) => (
                <li key={d.id} className="flex items-start gap-2 rounded-md bg-status-pending p-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-pending-foreground" aria-hidden />
                  <span>
                    {d.reason === "certificate_ref" ? t.review.duplicateRef : t.review.duplicateTitleDate} (
                    {d.same_student ? t.review.duplicateSameStudent : t.review.duplicateOtherStudent},{" "}
                    {t.status[d.status as keyof typeof t.status] ?? d.status}): <Link href={`/review/${d.id}`} className="text-primary-strong underline">{d.title}</Link>,{" "}
                    {formatDate(d.achievement_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {ai ? (
          <dl className="grid gap-2 border-t pt-3">
            {ai.document_kind ? (
              <div>
                <dt className="text-xs text-muted-foreground">{t.review.aiDocumentKind}</dt>
                <dd>{t.review.documentKinds[ai.document_kind] ?? ai.document_kind}</dd>
              </div>
            ) : null}
            {ai.confidence ? (
              <div>
                <dt className="text-xs text-muted-foreground">{t.review.aiConfidence}</dt>
                <dd>{t.review.confidence[ai.confidence] ?? ai.confidence}</dd>
              </div>
            ) : null}
            {ai.warnings?.length ? (
              <div>
                <dt className="text-xs text-muted-foreground">{t.review.aiWarnings}</dt>
                <dd>
                  <ul className="list-disc pl-5">
                    {ai.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}

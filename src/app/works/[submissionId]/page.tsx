import { BadgeCheck, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { Card, CardContent, Chip, ErrorState } from "@/components/ds";
import { LoadingState } from "@/components/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDate, t, typeName } from "@/i18n";
import { getFileAccess, getPublicWork } from "@/lib/db";
import { canViewFile, fileHref } from "@/lib/file-access";
import { getFileViewer } from "@/lib/file-viewer";
import type { PublicWorkPage } from "@/lib/types";

export const metadata: Metadata = { title: `${t.leaderboard.worksTitle} · ${t.common.appName}` };

// Public page of one approved work: metadata always (CLAUDE.md rule 5), never points (rule 11).
// The "View document" link shows only to viewers canViewFile() allows; the file itself comes from /api/files/:id.
export default function WorkPage({ params }: PageProps<"/works/[submissionId]">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Suspense fallback={<LoadingState />}>
        <WorkLoader params={params} />
      </Suspense>
    </div>
  );
}

async function WorkLoader({ params }: { params: PageProps<"/works/[submissionId]">["params"] }) {
  const id = z.uuid().safeParse((await params).submissionId);
  let work: PublicWorkPage | null = null;
  if (id.success) {
    try {
      work = await getPublicWork(id.data);
    } catch (error) {
      console.error("load public work failed", error);
      return <ErrorState message={t.work.loadError} />;
    }
  }
  if (!work) {
    return (
      <Alert>
        <AlertDescription>{t.work.notFound}</AlertDescription>
      </Alert>
    );
  }

  const rows: [string, React.ReactNode][] = [
    [t.work.type, typeName(work.type_name)],
    [t.work.issuer, work.issuer],
    [t.work.date, formatDate(work.achievement_date)],
    [t.work.level, t.levels[work.level]],
    ...(work.result !== "confirmed" ? ([[t.work.result, t.results[work.result]]] as [string, React.ReactNode][]) : []),
    ...(work.certificate_ref
      ? ([[t.work.certificateRef, <CertificateRef key="ref" value={work.certificate_ref} />]] as [string, React.ReactNode][])
      : []),
  ];

  return (
    <>
      <Link
        href={`/students/${work.student_id}`}
        className="w-fit text-sm text-primary-strong underline-offset-4 hover:underline"
      >
        ← {t.work.backToStudent}
      </Link>
      <Card className="gap-5 py-5">
        <CardContent className="grid gap-5 px-5 sm:px-6">
          <div className="grid gap-3">
            <Chip tone="approved" className="w-fit gap-1" title={t.work.verifiedHint}>
              <BadgeCheck className="size-3.5" aria-hidden />
              {t.work.verified}
            </Chip>
            <h1 className="text-h2 break-words">{work.title}</h1>
            <p className="text-small text-muted-foreground">
              {t.work.student}:{" "}
              <Link href={`/students/${work.student_id}`} className="font-medium text-primary-text underline-offset-4 hover:underline">
                {work.full_name}
              </Link>
              {" · "}
              {[work.faculty, work.university].filter(Boolean).join(" · ")}
            </p>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-small text-muted-foreground">{label}</dt>
                <dd className="font-medium break-words">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="border-t pt-4">
            {work.file_public ? (
              <DocumentButton submissionId={work.submission_id} />
            ) : (
              <Suspense fallback={<p className="text-small text-muted-foreground">{t.work.documentHidden}</p>}>
                <ViewerDocumentLink submissionId={work.submission_id} />
              </Suspense>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// Not public: the owner, reviewers, admins and (for 'verified') verified employers still get the link.
async function ViewerDocumentLink({ submissionId }: { submissionId: string }) {
  let allowed = false;
  try {
    const viewer = await getFileViewer();
    if (viewer.kind === "user") {
      const file = await getFileAccess(submissionId);
      allowed = !!file && file.status === "approved" && canViewFile(file, viewer);
    }
  } catch (error) {
    console.error("document access check failed", error);
  }
  if (allowed) return <DocumentButton submissionId={submissionId} />;
  return <p className="text-small text-muted-foreground">{t.work.documentHidden}</p>;
}

function DocumentButton({ submissionId }: { submissionId: string }) {
  return (
    <Button asChild variant="outline" className="rounded-full">
      <a href={fileHref(submissionId)} target="_blank" rel="noopener noreferrer nofollow">
        <FileText aria-hidden />
        {t.files.viewDocument}
      </a>
    </Button>
  );
}

// A DOI or certificate number as text; only http(s) links become links.
function CertificateRef({ value }: { value: string }) {
  if (/^https?:\/\//i.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="nofollow noopener noreferrer"
        className="break-all text-accent-text underline underline-offset-4"
      >
        {value}
      </a>
    );
  }
  return <span className="break-all">{value}</span>;
}

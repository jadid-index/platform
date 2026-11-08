import { Suspense } from "react";
import { z } from "zod";

import { ErrorState } from "@/components/ds";
import { LoadingState } from "@/components/loading-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { t } from "@/i18n";
import { loadCvForViewer } from "@/lib/cv";
import { getFileViewer } from "@/lib/file-viewer";
import type { CvView } from "@/lib/types";

import { CvDocument } from "./cv-document";
import { CvToolbar } from "./cv-toolbar";

// Shared by /cv/[studentId] and its print version. cvAccess() decides; whoever may not open the CV sees the same
// "not found" as for a CV that does not exist. Employer and admin views are logged (in loadCvForViewer).
export function CvPageBody({ params, print }: { params: Promise<{ studentId: string }>; print: boolean }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <CvLoader params={params} print={print} />
    </Suspense>
  );
}

async function CvLoader({ params, print }: { params: Promise<{ studentId: string }>; print: boolean }) {
  const id = z.uuid().safeParse((await params).studentId);
  let cv: CvView | null = null;
  if (id.success) {
    try {
      cv = await loadCvForViewer(id.data, await getFileViewer(), print ? "print" : "cv");
    } catch (error) {
      console.error("load cv failed", error);
      return <ErrorState message={t.cv.loadError} />;
    }
  }
  if (!cv) {
    return (
      <Alert>
        <AlertTitle>{t.cv.notFoundTitle}</AlertTitle>
        <AlertDescription>{t.cv.notFoundText}</AlertDescription>
      </Alert>
    );
  }
  return (
    <>
      <CvToolbar studentId={cv.student_id} print={print} />
      <div
        className={
          print
            ? "cv-sheet mx-auto w-full max-w-[210mm] rounded-lg border bg-surface-raised p-6 sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0"
            : "rounded-xl border bg-surface-raised p-5 sm:p-8"
        }
      >
        <CvDocument cv={cv} />
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ErrorState, ListSkeleton, SectionHeader } from "@/components/ds";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { getOwnCv, getProfileAccess } from "@/lib/db";
import type { OwnCv } from "@/lib/types";

import { CvEditor } from "./cv-editor";

export const metadata: Metadata = { title: `${t.cv.title} · ${t.common.appName}`, robots: { index: false } };

// The student's CV editor (CLAUDE.md rule 12). Students only; the proxy sends signed-out visitors to /login,
// this page checks again. Saving goes through PUT /api/me/cv, visibility through PATCH /api/me/cv/visibility.
export default function CvPage() {
  return (
    <div className="grid gap-4">
      <SectionHeader as="h1" title={t.cv.title} description={t.cv.description} />
      <Suspense fallback={<ListSkeleton rows={5} />}>
        <CvLoader />
      </Suspense>
    </div>
  );
}

async function CvLoader() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let access: Awaited<ReturnType<typeof getProfileAccess>>;
  try {
    access = await getProfileAccess(user.id);
  } catch (error) {
    console.error("load profile access failed", error);
    return <ErrorState message={t.cv.loadError} />;
  }
  if (!access) redirect("/onboarding");
  if (access.role === "employer") redirect("/talent");
  if (access.role !== "student") redirect("/dashboard");
  if (access.status !== "active") {
    return (
      <Alert>
        <AlertDescription>{t.cv.blocked}</AlertDescription>
      </Alert>
    );
  }

  let cv: OwnCv | null;
  try {
    cv = await getOwnCv(user.id);
  } catch (error) {
    console.error("load own cv failed", error);
    return <ErrorState message={t.cv.loadError} />;
  }
  if (!cv) return <ErrorState message={t.cv.loadError} />;
  return (
    <>
      {cv.updated_at === null ? (
        <Alert>
          <AlertDescription>{t.cv.empty}</AlertDescription>
        </Alert>
      ) : null}
      <CvEditor initial={cv} />
    </>
  );
}

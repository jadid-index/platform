import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ErrorState, SectionHeader } from "@/components/ds";
import { LoadingState } from "@/components/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { getMeta, getOwnRejectedSubmission, getProfileAccess } from "@/lib/db";
import type { Meta, RejectedSubmission } from "@/lib/types";

import { AchievementForm } from "./achievement-form";

export const metadata: Metadata = { title: `${t.achievement.title} · ${t.common.appName}` };

// Desktop: the form beside the file preview and what was read from the document. Phones: one column, as before.
export default function NewAchievementPage({ searchParams }: PageProps<"/achievements/new">) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <Link href="/dashboard" className="w-fit text-sm text-primary-strong underline-offset-4 hover:underline">
        ← {t.achievement.back}
      </Link>
      <Suspense fallback={<LoadingState />}>
        <AchievementLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AchievementLoader({ searchParams }: { searchParams: PageProps<"/achievements/new">["searchParams"] }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const resubmitId = z.uuid().safeParse((await searchParams).resubmit);

  let meta: Meta;
  let access: Awaited<ReturnType<typeof getProfileAccess>>;
  let parent: RejectedSubmission | null = null;
  try {
    [meta, access, parent] = await Promise.all([
      getMeta(),
      getProfileAccess(user.id),
      // Only the student's own rejected submission; anything else opens an empty form.
      resubmitId.success ? getOwnRejectedSubmission(resubmitId.data, user.id) : Promise.resolve(null),
    ]);
  } catch (error) {
    console.error("load achievement form failed", error);
    return <ErrorState message={t.achievement.metaError} />;
  }
  if (!access) redirect("/onboarding");

  const header = (
    <SectionHeader
      as="h1"
      title={parent ? t.achievement.resubmitTitle : t.achievement.title}
      description={parent ? t.achievement.resubmitIntro : t.achievement.subtitle}
    />
  );

  if (access.role !== "student" || access.status !== "active") {
    return (
      <>
        {header}
        <Alert>
          <AlertDescription>{t.errors.profileNotActive}</AlertDescription>
        </Alert>
      </>
    );
  }
  if (meta.achievement_types.length === 0) {
    return (
      <>
        {header}
        <Alert>
          <AlertDescription>{t.achievement.noTypes}</AlertDescription>
        </Alert>
      </>
    );
  }

  return (
    <>
      {header}
      <AchievementForm key={parent?.id ?? "new"} meta={meta} parent={parent} />
    </>
  );
}

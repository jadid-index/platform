import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth-card";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { getMeta, getProfileAccess } from "@/lib/db";
import type { Meta } from "@/lib/types";

import { AchievementForm } from "./achievement-form";

export const metadata: Metadata = { title: `${t.achievement.title} · ${t.common.appName}` };

export default function NewAchievementPage() {
  return (
    <AuthCard title={t.achievement.title} description={t.achievement.subtitle}>
      <Link href="/dashboard" className="mb-4 inline-block text-sm text-primary-strong underline-offset-4 hover:underline">
        ← {t.achievement.back}
      </Link>
      <Suspense fallback={<LoadingState />}>
        <AchievementLoader />
      </Suspense>
    </AuthCard>
  );
}

async function AchievementLoader() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let meta: Meta;
  let access: Awaited<ReturnType<typeof getProfileAccess>>;
  try {
    [meta, access] = await Promise.all([getMeta(), getProfileAccess(user.id)]);
  } catch (error) {
    console.error("load achievement form failed", error);
    return <ErrorState message={t.achievement.metaError} />;
  }
  if (!access) redirect("/onboarding");
  if (access.role !== "student" || access.status !== "active") {
    return (
      <Alert>
        <AlertDescription>{t.errors.profileNotActive}</AlertDescription>
      </Alert>
    );
  }
  if (meta.achievement_types.length === 0) {
    return (
      <Alert>
        <AlertDescription>{t.achievement.noTypes}</AlertDescription>
      </Alert>
    );
  }

  return <AchievementForm meta={meta} />;
}

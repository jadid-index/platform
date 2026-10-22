import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth-card";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { t } from "@/i18n";
import { listUniversitiesWithFaculties } from "@/lib/db";
import type { University } from "@/lib/types";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: `${t.signup.title} · ${t.common.appName}` };

export default function SignupPage() {
  return (
    <AuthCard title={t.signup.title} description={t.signup.subtitle}>
      <Suspense fallback={<LoadingState />}>
        <SignupLoader />
      </Suspense>
    </AuthCard>
  );
}

async function SignupLoader() {
  await connection();

  let universities: University[];
  try {
    universities = await listUniversitiesWithFaculties();
  } catch (error) {
    console.error("load universities failed", error);
    return <ErrorState message={t.form.optionsError} />;
  }

  if (universities.length === 0) {
    return (
      <Alert>
        <AlertDescription>{t.form.noUniversities}</AlertDescription>
      </Alert>
    );
  }

  return <SignupForm universities={universities} />;
}

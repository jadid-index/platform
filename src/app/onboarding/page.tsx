import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth-card";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import type { ProfileValues } from "@/components/profile-fields";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { CONSENT_VERSION } from "@/lib/consent";
import { getProfileSummary, listUniversitiesWithFaculties } from "@/lib/db";
import type { University } from "@/lib/types";

import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: `${t.onboarding.title} · ${t.common.appName}` };

export default function OnboardingPage() {
  return (
    <AuthCard title={t.onboarding.title} description={t.onboarding.subtitle}>
      <Suspense fallback={<LoadingState />}>
        <OnboardingLoader />
      </Suspense>
    </AuthCard>
  );
}

async function OnboardingLoader() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let universities: University[];
  let hasProfile: boolean;
  try {
    [universities, hasProfile] = await Promise.all([
      listUniversitiesWithFaculties(),
      getProfileSummary(user.id).then((p) => p !== null),
    ]);
  } catch (error) {
    console.error("load onboarding failed", error);
    return <ErrorState />;
  }
  if (hasProfile) redirect("/dashboard");

  return <OnboardingForm universities={universities} initial={valuesFromMetadata(user.user_metadata)} />;
}

// Prefill from what the student entered at sign-up. User metadata is user-controlled, so it is
// only a suggestion here; /api/profile validates the submitted values again.
function valuesFromMetadata(meta: Record<string, unknown>): ProfileValues {
  const id = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? String(v) : "");
  return {
    fullName: typeof meta.full_name === "string" ? meta.full_name : "",
    universityId: id(meta.university_id),
    facultyId: id(meta.faculty_id),
    course: id(meta.course),
    consent: meta.consent_version === CONSENT_VERSION,
  };
}

"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  ProfileFields,
  toProfileBody,
  validateProfileValues,
  type ProfileErrors,
  type ProfileValues,
} from "@/components/profile-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { CONSENT_VERSION } from "@/lib/consent";
import type { University } from "@/lib/types";

const API_ERRORS: Record<string, string> = {
  unauthorized: t.errors.unauthorized,
  email_not_verified: t.errors.emailNotConfirmed,
  domain_not_allowed: t.errors.domainNotAllowed,
  consent_outdated: t.errors.consentOutdated,
  faculty_mismatch: t.errors.facultyMismatch,
};

export function OnboardingForm({
  universities,
  initial,
}: {
  universities: University[];
  initial: ProfileValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProfileValues>(() => {
    // Drop a stale faculty or university that no longer exists.
    const university = universities.find((u) => String(u.id) === initial.universityId);
    const facultyOk = university?.faculties.some((f) => String(f.id) === initial.facultyId);
    return {
      ...initial,
      universityId: university ? initial.universityId : universities.length === 1 ? String(universities[0].id) : "",
      facultyId: facultyOk ? initial.facultyId : "",
    };
  });
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const nextErrors = validateProfileValues(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toProfileBody(values, CONSENT_VERSION)),
      });
      // 409 means the profile already exists, so the dashboard is the right place either way.
      if (res.ok || res.status === 409) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      setFormError((error && API_ERRORS[error]) || t.common.genericError);
    } catch {
      setFormError(t.common.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={onSubmit}>
      <ProfileFields
        universities={universities}
        values={values}
        errors={errors}
        disabled={submitting}
        onChange={setValues}
      />

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={!values.consent || submitting}>
        {submitting ? t.onboarding.submitting : t.onboarding.submit}
      </Button>
    </form>
  );
}

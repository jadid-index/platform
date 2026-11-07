"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field } from "@/components/field";
import {
  AccountTypeChoice,
  EmployerFields,
  emptyEmployerValues,
  toEmployerBody,
  validateEmployerValues,
  type AccountType,
  type EmployerErrors,
  type EmployerValues,
} from "@/components/employer-fields";
import { GoogleButton, OrDivider } from "@/components/google-button";
import {
  emptyProfileValues,
  ProfileFields,
  toProfileBody,
  validateProfileValues,
  type ProfileErrors,
  type ProfileValues,
} from "@/components/profile-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, t } from "@/i18n";
import { CONSENT_VERSION } from "@/lib/consent";
import { createAuthClient } from "@/lib/supabase/client";
import type { University } from "@/lib/types";
import { emailSchema, PASSWORD_MIN_LENGTH } from "@/lib/validation";

type Errors = ProfileErrors & EmployerErrors & { email?: string; password?: string };

export function SignupForm({ universities, initialType }: { universities: University[]; initialType: AccountType }) {
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType>(initialType);
  const [employer, setEmployer] = useState<EmployerValues>(emptyEmployerValues);
  const [profile, setProfile] = useState<ProfileValues>(() => emptyProfileValues(universities));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const isEmployer = accountType === "employer";
    const nextErrors: Errors = isEmployer ? validateEmployerValues(employer) : validateProfileValues(profile);
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) nextErrors.email = t.errors.emailInvalid;
    if (password.length < PASSWORD_MIN_LENGTH) nextErrors.password = t.errors.passwordTooShort;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !parsedEmail.success) return;

    setSubmitting(true);
    try {
      // 1. Create the auth user. Pilot sign-up is open (any email, no verification), so with
      //    "Confirm email" off in Supabase Auth this returns a session right away.
      //    The profile fields also travel in user metadata, so onboarding can prefill them.
      const profileBody = isEmployer ? toEmployerBody(employer) : toProfileBody(profile, CONSENT_VERSION);
      const supabase = createAuthClient();
      const { data, error } = await supabase.auth.signUp({
        email: parsedEmail.data,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
          // Metadata is only a prefill for onboarding: the student fields, or for employers just the choice
          // (signup_as). The role is never read from metadata; POST /api/profile decides it from the body.
          data: isEmployer ? { signup_as: "employer" } : { ...profileBody, role: undefined },
        },
      });
      if (error) {
        if (error.status === 429) setFormError(t.errors.rateLimited);
        else if (error.code === "weak_password") setErrors({ password: t.errors.passwordTooShort });
        else setFormError(t.common.genericError);
        return;
      }
      // Fallback while "Confirm email" is still on: no session until the link is clicked.
      if (!data.session) {
        setSentTo(parsedEmail.data);
        return;
      }

      // 2. Create the profile. If that fails, onboarding shows the error and lets the student retry.
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileBody),
      });
      router.replace(res.ok || res.status === 409 ? (isEmployer ? "/talent" : "/dashboard") : isEmployer ? "/onboarding?as=employer" : "/onboarding");
      router.refresh();
    } catch {
      setFormError(t.common.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <Alert className="border-primary bg-primary-soft">
        <MailCheck aria-hidden />
        <AlertTitle>{t.signup.checkEmailTitle}</AlertTitle>
        <AlertDescription className="text-foreground">
          <p>{format(t.signup.checkEmailBody, { email: sentTo })}</p>
          <p className="text-muted-foreground">{t.signup.checkEmailHint}</p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={onSubmit}>
      <AccountTypeChoice value={accountType} disabled={submitting} onChange={setAccountType} />
      <GoogleButton disabled={submitting} />
      <OrDivider />

      <Field
        id="email"
        label={t.form.email}
        error={errors.email}
        hint={accountType === "employer" ? t.employerForm.emailHint : undefined}
      >
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          className="h-10"
          placeholder={accountType === "employer" ? t.employerForm.emailPlaceholder : t.form.emailPlaceholder}
          value={email}
          disabled={submitting}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email || accountType === "employer" ? "email-message" : undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field id="password" label={t.form.password} hint={t.form.passwordHint} error={errors.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          className="h-10"
          value={password}
          disabled={submitting}
          aria-invalid={!!errors.password}
          aria-describedby="password-message"
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {accountType === "employer" ? (
        <EmployerFields values={employer} errors={errors} disabled={submitting} onChange={setEmployer} />
      ) : (
        <ProfileFields
          universities={universities}
          values={profile}
          errors={errors}
          disabled={submitting}
          onChange={setProfile}
        />
      )}

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={(accountType === "employer" ? !employer.terms : !profile.consent) || submitting}>
        {submitting ? t.signup.submitting : t.signup.submit}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t.signup.haveAccount}{" "}
        <Link href="/login" className="font-medium text-primary-strong underline-offset-4 hover:underline">
          {t.signup.loginLink}
        </Link>
      </p>
    </form>
  );
}

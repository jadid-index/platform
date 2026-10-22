"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Field } from "@/components/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { createAuthClient } from "@/lib/supabase/client";
import { emailSchema } from "@/lib/validation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(
    searchParams.get("error") === "confirm_failed" ? t.errors.confirmFailed : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success || !password) {
      setFormError(t.errors.invalidCredentials);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await createAuthClient().auth.signInWithPassword({
        email: parsedEmail.data,
        password,
      });
      if (error) {
        if (error.code === "email_not_confirmed") setFormError(t.errors.emailNotConfirmed);
        else if (error.status === 429) setFormError(t.errors.rateLimited);
        else if (error.code === "invalid_credentials") setFormError(t.errors.invalidCredentials);
        else setFormError(t.common.genericError);
        return;
      }
      // This page stays mounted in the background after navigating away, so do not keep the password.
      setPassword("");
      // The dashboard sends users without a profile to onboarding.
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setFormError(t.common.genericError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={onSubmit}>
      <Field id="email" label={t.form.email}>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          className="h-10"
          placeholder={t.form.emailPlaceholder}
          value={email}
          disabled={submitting}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field id="password" label={t.form.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="h-10"
          value={password}
          disabled={submitting}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? t.login.submitting : t.login.submit}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t.login.noAccount}{" "}
        <Link href="/signup" className="font-medium text-primary-strong underline-offset-4 hover:underline">
          {t.login.signupLink}
        </Link>
      </p>
    </form>
  );
}

"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { createAuthClient } from "@/lib/supabase/client";

// "Continue with Google" for both login and sign-up (Google does not distinguish them).
// PKCE: the browser client stores the code verifier in a cookie and /auth/callback exchanges the code.
// Users without a profile are sent on to /onboarding by the proxy.
export function GoogleButton({ next = "/dashboard", disabled }: { next?: string; disabled?: boolean }) {
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setRedirecting(true);
    const { error } = await createAuthClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    // On success the browser is already navigating to Google, so only failures reset the button.
    if (error) {
      setError(error.status === 429 ? t.errors.rateLimited : t.common.genericError);
      setRedirecting(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Button type="button" variant="outline" size="lg" className="w-full" disabled={disabled || redirecting} onClick={onClick}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark */}
        <img src="/google-g.svg" alt="" aria-hidden width={18} height={18} />
        {redirecting ? t.auth.googleRedirecting : t.auth.google}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

// "yoki" separator between the Google button and the email form.
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      {t.auth.or}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

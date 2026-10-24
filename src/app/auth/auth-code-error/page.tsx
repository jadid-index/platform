import { AlertCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export const metadata: Metadata = { title: `${t.auth.codeErrorTitle} · ${t.common.appName}` };

// Shown when the Google sign-in could not be completed (cancelled, expired or invalid code).
export default function AuthCodeErrorPage() {
  return (
    <AuthCard title={t.auth.codeErrorTitle}>
      <div className="grid gap-4">
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{t.auth.codeErrorBody}</AlertDescription>
        </Alert>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">{t.auth.toLogin}</Link>
        </Button>
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/signup">{t.auth.toSignup}</Link>
        </Button>
      </div>
    </AuthCard>
  );
}

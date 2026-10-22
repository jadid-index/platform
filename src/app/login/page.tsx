import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth-card";
import { LoadingState } from "@/components/loading-state";
import { t } from "@/i18n";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: `${t.login.title} · ${t.common.appName}` };

export default function LoginPage() {
  return (
    <AuthCard title={t.login.title} description={t.login.subtitle}>
      <Suspense fallback={<LoadingState />}>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}

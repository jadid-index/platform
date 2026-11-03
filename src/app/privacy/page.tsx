import type { Metadata } from "next";

import { Card, CardContent } from "@/components/ds";
import { format, formatDate, t } from "@/i18n";
import { ru } from "@/i18n/ru";

export const metadata: Metadata = { title: `${t.privacy.title} · ${t.common.appName}` };

type Policy = typeof t.privacy;

// Static. Uzbek first, the Russian version below. The text lives in the translation files and is a draft until
// the team's final text arrives (docs/consent-v2.md).
export default function PrivacyPage() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PolicyText policy={t.privacy} headingId="privacy-title" />
      <details className="rounded-2xl border bg-surface-raised p-5 shadow-card">
        <summary className="cursor-pointer font-semibold text-primary-text">{t.privacy.russian}</summary>
        <div lang="ru" className="mt-4">
          <PolicyText policy={ru.privacy} headingId="privacy-title-ru" plain />
        </div>
      </details>
    </div>
  );
}

function PolicyText({ policy, headingId, plain }: { policy: Policy; headingId: string; plain?: boolean }) {
  const body = (
    <div className="grid gap-5">
      <header className="grid gap-2">
        {policy.draft ? (
          <p className="w-fit rounded-md bg-warning px-2 py-1 text-xs font-semibold text-warning-foreground">
            {policy.draftLabel}
          </p>
        ) : null}
        {plain ? (
          <h2 id={headingId} className="text-h2">
            {policy.title}
          </h2>
        ) : (
          <h1 id={headingId} className="text-h1">
            {policy.title}
          </h1>
        )}
        <p className="text-small text-muted-foreground">{format(policy.updated, { date: formatDate(policy.updatedDate) })}</p>
      </header>
      {policy.sections.map((section) => (
        <section key={section.title} className="grid gap-1.5">
          <h3 className="text-body font-semibold">{section.title}</h3>
          <p className="text-muted-foreground">{section.text}</p>
        </section>
      ))}
    </div>
  );
  if (plain) return body;
  return (
    <Card className="py-6">
      <CardContent className="px-5 sm:px-8">{body}</CardContent>
    </Card>
  );
}

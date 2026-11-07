import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Card, CardContent, Chip, EmptyState, ErrorState, ListSkeleton, SectionHeader } from "@/components/ds";
import { checkTalentPage } from "@/components/talent-gate";
import { format, formatDate, t } from "@/i18n";
import { listEmployerContactRequests } from "@/lib/db";
import type { EmployerSentRequest } from "@/lib/types";

export const metadata: Metadata = { title: `${t.talent.requestsTitle} · ${t.common.appName}`, robots: { index: false } };

const STATUS_TONE = { pending: "pending", accepted: "approved", declined: "muted" } as const;

// Employers only: their sent requests. A contact detail shows only for accepted requests of active students.
export default function SentRequestsPage() {
  return (
    <div className="grid gap-4">
      <SectionHeader as="h1" title={t.talent.requestsTitle} description={t.talent.requestsDescription} />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <SentRequests />
      </Suspense>
    </div>
  );
}

async function SentRequests() {
  const viewer = await checkTalentPage();
  if (viewer.role !== "employer") redirect("/talent");

  let rows: EmployerSentRequest[];
  try {
    rows = await listEmployerContactRequests(viewer.userId);
  } catch (error) {
    console.error("load sent requests failed", error);
    return <ErrorState message={t.talent.requestsError} />;
  }
  if (rows.length === 0) return <EmptyState text={t.talent.requestsEmpty} />;

  return (
    <ul className="grid gap-3">
      {rows.map((r) => (
        <li key={r.id}>
          <Card className="gap-2 py-4">
            <CardContent className="grid gap-2 px-4 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Chip tone={STATUS_TONE[r.status]}>{t.talent.statuses[r.status]}</Chip>
                <span className="text-small text-muted-foreground tabular">
                  {format(t.talent.sentOn, { date: formatDate(r.created_at) })}
                </span>
              </div>
              {r.full_name ? (
                <Link
                  href={`/talent/${r.student_id}`}
                  className="w-fit font-medium break-words underline-offset-4 hover:text-primary-text hover:underline"
                >
                  {r.full_name}
                </Link>
              ) : (
                <p className="font-medium text-muted-foreground">{t.talent.hiddenStudent}</p>
              )}
              <p className="text-small break-words whitespace-pre-line text-muted-foreground">{r.message}</p>
              {r.status === "accepted" ? (
                r.shared_contact ? (
                  <p className="font-medium break-all">
                    {t.talent.contactKinds[r.shared_contact.kind]}: {r.shared_contact.value}
                  </p>
                ) : (
                  <p className="text-small text-muted-foreground">{t.talent.contactHidden}</p>
                )
              ) : null}
              {r.status === "declined" && r.resend_after ? (
                <p className="text-small text-muted-foreground">{format(t.talent.declined, { date: formatDate(r.resend_after) })}</p>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

import { BriefcaseBusiness, CircleCheck, CircleOff, ExternalLink, Handshake, MessageSquareText, ToggleRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle, Chip, ErrorState, ListSkeleton, SectionHeader, Skeleton, TierBadge } from "@/components/ds";
import { StudentAvatar } from "@/components/student-avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format, t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { getAuthEmail, getOpenToWork, getProfileAccess, getPublicStudent, listStudentContactRequests } from "@/lib/db";
import type { PublicStudent, StudentContactRequest } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ContactRequestList } from "./contact-request-list";
import { OpenToWorkControl } from "./open-to-work-control";

export const metadata: Metadata = { title: `${t.offers.title} · ${t.common.appName}`, robots: { index: false } };

// The student's work side: the open_to_work opt-in, how employers see them, and received contact requests.
// Students only; the data shown to employers is the public data of rule 5, never points (rule 11).
export default function OffersPage() {
  return (
    <Suspense fallback={<OffersSkeleton />}>
      <OffersContent />
    </Suspense>
  );
}

async function OffersContent() {
  // The proxy already redirects signed-out visitors; this is the authoritative check.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let access: Awaited<ReturnType<typeof getProfileAccess>>;
  try {
    access = await getProfileAccess(user.id);
  } catch (error) {
    console.error("load profile access failed", error);
    return <ErrorState />;
  }
  if (!access) redirect("/onboarding");
  if (access.role === "employer") redirect("/talent");
  if (access.role !== "student") redirect("/dashboard");

  if (access.status !== "active") {
    return (
      <div className="grid gap-4">
        <SectionHeader as="h1" title={t.offers.title} />
        <Alert>
          <AlertDescription>{t.offers.blocked}</AlertDescription>
        </Alert>
      </div>
    );
  }

  let openToWork: boolean;
  let rows: StudentContactRequest[];
  let email: string | null;
  try {
    [openToWork, rows, email] = await Promise.all([
      getOpenToWork(user.id),
      listStudentContactRequests(user.id),
      getAuthEmail(user.id),
    ]);
  } catch (error) {
    console.error("load offers failed", error);
    return <ErrorState message={t.contactRequests.error} />;
  }
  const pending = rows.filter((r) => r.status === "pending").length;
  const accepted = rows.filter((r) => r.status === "accepted").length;

  return (
    <div className="flex w-full flex-col gap-6">
      <Hero openToWork={openToWork} stats={{ pending, accepted, total: rows.length }} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <aside className="grid gap-4 lg:sticky lg:top-(--nav-offset)" aria-label={t.openToWork.title}>
          <Card className="gap-4 py-5">
            <CardHeader className="px-5">
              <CardTitle className="text-h2">{t.openToWork.title}</CardTitle>
            </CardHeader>
            <CardContent className="px-5">
              <OpenToWorkControl initial={openToWork} />
            </CardContent>
          </Card>
          <Suspense fallback={<Skeleton className="h-44 rounded-xl" />}>
            <EmployerPreview studentId={user.id} openToWork={openToWork} />
          </Suspense>
          <HowItWorks />
        </aside>

        <section className="grid content-start gap-4" aria-labelledby="contact-requests">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <SectionHeader
              id="contact-requests"
              title={t.contactRequests.title}
              description={t.offers.requestsDescription}
            />
            {pending > 0 ? <Chip tone="pending">{format(t.contactRequests.newBadge, { n: pending })}</Chip> : null}
          </div>
          <ContactRequestList rows={rows} accountEmail={email} openToWork={openToWork} />
        </section>
      </div>
    </div>
  );
}

// Dark panel with the page title, the directory status and the request counts. On #272727 the mint
// accent may be text (CLAUDE.md, colors); every status also has an icon and a label.
function Hero({ openToWork, stats }: { openToWork: boolean; stats: { pending: number; accepted: number; total: number } }) {
  const tiles = [
    { label: t.offers.statNew, value: stats.pending, highlight: stats.pending > 0 },
    { label: t.offers.statAccepted, value: stats.accepted, highlight: false },
    { label: t.offers.statTotal, value: stats.total, highlight: false },
  ];
  return (
    <section
      aria-labelledby="offers-title"
      className="relative isolate grid gap-6 overflow-hidden rounded-3xl bg-surface-inverse p-6 text-surface-inverse-foreground shadow-raised sm:p-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-center lg:gap-10 lg:p-10"
    >
      {/* Soft glow in the theme's primary and accent colors. Decoration only. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-20 -right-10 size-72 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -bottom-28 left-1/4 size-80 rounded-full bg-accent/25 blur-3xl" />
      </div>

      <div className="grid content-center gap-4">
        <p className="inline-flex w-fit items-center gap-2 rounded-full border border-surface-inverse-muted/40 px-3 py-1 text-small font-semibold text-surface-inverse-muted">
          <BriefcaseBusiness className="size-4" aria-hidden />
          {t.offers.badge}
        </p>
        <h1 id="offers-title" className="text-display">
          {t.offers.title}
        </h1>
        <p className="max-w-xl text-surface-inverse-muted">{t.offers.pitch}</p>
        <p
          className={cn(
            "inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-small font-semibold",
            openToWork
              ? "bg-primary text-primary-contrast"
              : "border border-surface-inverse-muted/40 text-surface-inverse-foreground",
          )}
        >
          {openToWork ? <CircleCheck className="size-4" aria-hidden /> : <CircleOff className="size-4" aria-hidden />}
          {openToWork ? t.offers.statusOn : t.offers.statusOff}
        </p>
      </div>

      <dl aria-label={t.offers.statsLabel} className="grid grid-cols-3 gap-2 sm:gap-3">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="grid content-between gap-2 rounded-2xl border border-surface-inverse-muted/20 bg-surface-inverse-foreground/5 p-3 backdrop-blur-sm sm:p-4"
          >
            <dt className="text-xs font-semibold text-surface-inverse-muted sm:text-small">{tile.label}</dt>
            <dd className={cn("text-h1 tabular", tile.highlight && "text-inverse-accent")}>{tile.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// The student's own row as the talent directory shows it: public fields only (rule 5), tier not points.
async function EmployerPreview({ studentId, openToWork }: { studentId: string; openToWork: boolean }) {
  let student: PublicStudent | null;
  try {
    student = await getPublicStudent(studentId);
  } catch (error) {
    console.error("load employer preview failed", error);
    return <ErrorState message={t.offers.previewError} />;
  }
  if (!student) return null;
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-body font-semibold">{t.offers.previewTitle}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-5">
        <div
          className={cn(
            "grid gap-3 rounded-2xl border bg-surface p-4 shadow-card",
            !openToWork && "border-dashed",
          )}
        >
          <div className="flex items-center gap-3">
            <StudentAvatar name={student.full_name} url={student.photo_url} className="size-12" />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="truncate font-semibold">{student.full_name}</p>
              <p className="truncate text-small text-muted-foreground">
                {[student.university, student.faculty].filter(Boolean).join(" · ")}
              </p>
            </div>
            <TierBadge tier={student.tier} size="sm" />
          </div>
          <p className="text-small text-muted-foreground">
            {student.approved_count > 0
              ? format(t.talent.works, { n: student.approved_count })
              : t.offers.previewEmpty}
          </p>
        </div>
        <p className="text-small text-muted-foreground">{openToWork ? t.offers.previewHintOn : t.offers.previewHintOff}</p>
        <Link
          href={`/students/${studentId}`}
          className="inline-flex w-fit items-center gap-1.5 text-small font-medium text-primary-text underline-offset-4 hover:underline"
        >
          {t.offers.publicPage}
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

const STEP_ICONS = [ToggleRight, MessageSquareText, Handshake];

function HowItWorks() {
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-body font-semibold">{t.offers.howTitle}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <ol className="grid gap-4">
          {t.offers.steps.map((step, i) => {
            const Icon = STEP_ICONS[i] ?? Handshake;
            return (
              <li key={step.title} className="flex gap-3">
                <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
                  <Icon className="size-4.5" aria-hidden />
                  <span className="absolute -top-1.5 -right-1.5 flex size-4.5 items-center justify-center rounded-full bg-surface-inverse text-[0.625rem] font-bold text-surface-inverse-foreground tabular">
                    {i + 1}
                  </span>
                </span>
                <div className="grid gap-0.5">
                  <p className="text-small font-semibold">{step.title}</p>
                  <p className="text-small text-muted-foreground">{step.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function OffersSkeleton() {
  return (
    <div role="status" aria-label={t.common.loading} className="flex w-full flex-col gap-6">
      <Skeleton className="h-64 rounded-3xl lg:h-56" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}

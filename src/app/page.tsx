import { ArrowRight, BadgeCheck, FlaskConical, HandHeart, Lightbulb, Sprout, Trophy, Upload, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import {
  CATEGORY_ORDER,
  CATEGORY_STYLES,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  SectionHeader,
  Skeleton,
  StatTile,
  TierBadge,
} from "@/components/ds";
import { StudentAvatar } from "@/components/student-avatar";
import { getShellViewer } from "@/components/shell/access";
import { Button } from "@/components/ui/button";
import { academicYearLabel, format, t, typeName } from "@/i18n";
import { getPublicCounts, getPublicTiersCached, getTopTierStudents, type PublicCounts } from "@/lib/db";
import type { PublicTier, TopTier } from "@/lib/types";
import { cn } from "@/lib/utils";

const TOP_COUNT = 5;

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  scientific: FlaskConical,
  innovation: Lightbulb,
  social: HandHeart,
  personal_growth: Sprout,
};

const STEP_ICONS: LucideIcon[] = [Upload, BadgeCheck, Trophy];

// Public landing page. No login needed; every number and name on it is public leaderboard data.
export default function HomePage() {
  return (
    <div className="grid gap-12 lg:gap-16">
      {/* Hero across the full width; the counters right under it; then the four categories next to the top students. */}
      <div className="grid gap-4 sm:gap-6">
        <Hero />
        <section aria-label={t.home.countersLabel}>
          <Suspense fallback={<CountersSkeleton />}>
            <Counters />
          </Suspense>
        </section>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-6">
        <section aria-labelledby="categories-title" className="grid gap-4">
          <SectionHeader id="categories-title" title={t.home.categoriesTitle} />
          <ul className="grid gap-3 sm:grid-cols-2">
            {CATEGORY_ORDER.map((code) => {
              const Icon = CATEGORY_ICONS[code];
              const { fill, ink } = CATEGORY_STYLES[code];
              return (
                <li key={code} className={cn("flex gap-4 rounded-2xl p-4 sm:grid sm:content-start sm:gap-3 sm:p-5", fill)}>
                  <span
                    className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-raised shadow-card", ink)}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="grid content-start gap-1">
                    <h3 className={cn("text-body font-bold", ink)}>{t.categories[code]}</h3>
                    <p className={cn("text-small", ink)}>{t.home.categoryText[code]}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="top-title">
          <Suspense fallback={<TopStudentsSkeleton />}>
            <TopStudents />
          </Suspense>
        </section>
      </div>

      <section aria-labelledby="how-title" className="grid gap-4">
        <SectionHeader id="how-title" title={t.home.howTitle} />
        <ol className="grid gap-3 md:grid-cols-3">
          {t.home.steps.map((step, i) => {
            const Icon = STEP_ICONS[i];
            return (
              <li key={step.title}>
                <Card className="h-full py-5">
                  <CardContent className="flex gap-4 px-5 md:grid md:gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <div className="grid content-start gap-1">
                      <p className="text-xs font-semibold tracking-wide text-primary-strong uppercase">
                        {format(t.home.step, { n: i + 1 })}
                      </p>
                      <h3 className="text-body font-semibold">{step.title}</h3>
                      <p className="text-small text-muted-foreground">{step.text}</p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      </section>

      <section
        aria-labelledby="cta-title"
        className="grid justify-items-start gap-4 rounded-3xl bg-primary p-6 text-primary-contrast shadow-card sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center"
      >
        <Suspense fallback={<ClosingCta viewer="guest" />}>
          <ClosingCtaForViewer />
        </Suspense>
      </section>

    </div>
  );
}

// Dark (inverse) panel with the headline and one visual: the real tier ladder, best first.
function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate grid items-center gap-8 overflow-hidden rounded-3xl bg-surface-inverse p-6 text-surface-inverse-foreground shadow-raised sm:p-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12 lg:p-14"
    >
      {/* Soft glow in the theme's primary and accent colors. Decoration only. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -right-16 size-80 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 size-96 rounded-full bg-accent/25 blur-3xl" />
      </div>

      <div className="grid content-center gap-5 sm:gap-6">
        <p className="w-fit rounded-full border border-surface-inverse-muted/40 px-3 py-1 text-small font-semibold text-surface-inverse-muted">
          {t.home.heroBadge}
        </p>
        <h1 id="hero-title" className="text-display text-balance">
          {t.home.heroTitleLead} <span className="text-inverse-accent">{t.home.heroTitleAccent}</span>
        </h1>
        <p className="max-w-xl text-surface-inverse-muted">{t.home.heroText}</p>
        <div className="flex flex-wrap gap-3">
          <Suspense fallback={<PrimaryAction href="/signup" label={t.home.signup} />}>
            <HeroPrimaryAction />
          </Suspense>
          <Button asChild variant="outline" size="lg" className="rounded-full">
            <Link href="/leaderboard">
              <Trophy aria-hidden />
              {t.home.toLeaderboard}
            </Link>
          </Button>
        </div>
      </div>

      <Suspense fallback={<TierLadderSkeleton />}>
        <TierLadder />
      </Suspense>
    </section>
  );
}

// The tier ladder from the tiers table (codes and names only, no thresholds): each step a little shorter.
async function TierLadder() {
  let tiers: PublicTier[];
  try {
    tiers = await getPublicTiersCached();
  } catch (error) {
    console.error("load tiers failed", error);
    return null;
  }
  if (tiers.length === 0) return null;
  return (
    <ol aria-label={t.home.heroLadderLabel} className="grid gap-2">
      {tiers.map((tier, i) => (
        <li
          key={tier.code}
          style={{ width: `${100 - (i * 40) / Math.max(tiers.length - 1, 1)}%` }}
          className={cn(
            "flex items-center gap-3 rounded-2xl border border-surface-inverse-muted/20 bg-surface-inverse-foreground/5 p-2 pr-4 backdrop-blur-sm",
            // Phones: the four best steps are enough for the picture.
            i >= 4 && "max-sm:hidden",
          )}
        >
          <TierBadge tier={tier} size="sm" className="h-9 min-w-12 text-body ring-surface-inverse-muted/40" />
          <span className="truncate text-small font-semibold text-surface-inverse-foreground">
            {format(t.leaderboard.tierSection, { tier: typeName(tier.label) })}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TierLadderSkeleton() {
  return (
    <div role="status" aria-label={t.common.loading} className="grid gap-2">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          style={{ width: `${100 - i * 10}%` }}
          className="h-13 rounded-2xl bg-surface-inverse-foreground/10"
        />
      ))}
    </div>
  );
}

function PrimaryAction({ href, label, inverse = false }: { href: string; label: string; inverse?: boolean }) {
  return (
    <Button asChild size="lg" variant={inverse ? "inverse" : "default"} className="rounded-full">
      <Link href={href}>
        {label}
        <ArrowRight aria-hidden />
      </Link>
    </Button>
  );
}

// Signed in: the first button goes to the dashboard instead of sign-up.
async function HeroPrimaryAction() {
  const viewer = await getShellViewer();
  return viewer.kind === "guest" ? (
    <PrimaryAction href="/signup" label={t.home.signup} />
  ) : (
    <PrimaryAction href="/dashboard" label={t.home.toDashboard} />
  );
}

async function Counters() {
  let counts: PublicCounts;
  try {
    counts = await getPublicCounts();
  } catch (error) {
    console.error("load public counts failed", error);
    return <ErrorState message={t.home.countersError} />;
  }
  const tiles = [
    { label: t.home.statStudents, value: counts.students },
    { label: t.home.statApproved, value: counts.approved },
    { label: t.home.statUniversities, value: counts.universities },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 sm:gap-3">
      {tiles.map((tile) => (
        <StatTile key={tile.label} label={tile.label} value={tile.value} className="content-start p-3 sm:p-5" />
      ))}
    </dl>
  );
}

function CountersSkeleton() {
  return (
    <div role="status" aria-label={t.common.loading} className="grid grid-cols-3 gap-2 sm:gap-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="grid gap-2 rounded-xl border bg-surface-raised p-3 sm:p-4">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-7 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// The best non-empty tier of the default leaderboard view (same source and order as /leaderboard):
// its first students by name, with a link to the rest. No points, no ranks.
async function TopStudents() {
  let top: TopTier;
  try {
    top = await getTopTierStudents(TOP_COUNT);
  } catch (error) {
    console.error("load top students failed", error);
    return (
      <TopCard description={null}>
        <ErrorState message={t.home.topError} />
      </TopCard>
    );
  }
  const period =
    top.academic_year === "all" ? t.home.topAllTime : format(t.home.topYear, { year: academicYearLabel(top.academic_year) });

  if (!top.tier) {
    return (
      <TopCard description={period}>
        <EmptyState icon={Trophy} text={t.leaderboard.emptyAll} />
      </TopCard>
    );
  }

  return (
    <TopCard
      description={format(t.home.topTier, { tier: typeName(top.tier.label), period })}
      badge={<TierBadge tier={top.tier} className="h-[44px]" />}
    >
      <ul className="grid gap-1">
        {top.rows.map((row) => (
          <li key={row.student_id}>
            <Link
              href={`/students/${row.student_id}`}
              className="flex items-center gap-3 rounded-lg px-2 py-2 outline-none hover:bg-primary-soft/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <StudentAvatar name={row.full_name} url={row.photo_url} className="size-8" />
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-medium">{row.full_name}</span>
                {row.faculty ? <span className="truncate text-small text-muted-foreground">{row.faculty}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {top.total > top.rows.length ? (
        <p className="px-2 text-small text-muted-foreground">{format(t.home.topMore, { n: top.total - top.rows.length })}</p>
      ) : null}
    </TopCard>
  );
}

function TopCard({
  description,
  badge,
  children,
}: {
  description: string | null;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="h-full gap-4 py-5">
      <CardHeader className="flex items-start gap-3 px-5">
        {badge}
        <div className="grid gap-1.5">
          <CardTitle id="top-title" className="text-h2">
            {t.home.topTitle}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 px-3 sm:px-4">
        {children}
        <Button asChild variant="link" className="w-fit px-2">
          <Link href="/leaderboard">
            {t.home.topLink}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function TopStudentsSkeleton() {
  return (
    <Card className="h-full gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle id="top-title" className="text-h2">
          {t.home.topTitle}
        </CardTitle>
      </CardHeader>
      <CardContent role="status" aria-label={t.common.loading} className="grid gap-3 px-5">
        {Array.from({ length: TOP_COUNT }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Guests are asked to sign up, students to add an achievement, everyone else goes to the dashboard.
async function ClosingCtaForViewer() {
  const viewer = await getShellViewer();
  if (viewer.kind === "guest") return <ClosingCta viewer="guest" />;
  return <ClosingCta viewer={viewer.kind === "member" && viewer.role === "student" ? "student" : "other"} />;
}

function ClosingCta({ viewer }: { viewer: "guest" | "student" | "other" }) {
  return (
    <>
      <div className="grid gap-2">
        <h2 id="cta-title" className="text-h2">
          {t.home.ctaTitle}
        </h2>
        <p>{viewer === "guest" ? t.home.ctaText : t.home.ctaTextMember}</p>
      </div>
      {viewer === "guest" ? (
        <PrimaryAction inverse href="/signup" label={t.home.signup} />
      ) : viewer === "student" ? (
        <PrimaryAction inverse href="/achievements/new" label={t.home.addAchievement} />
      ) : (
        <PrimaryAction inverse href="/dashboard" label={t.home.toDashboard} />
      )}
    </>
  );
}

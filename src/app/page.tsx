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
  RankBadge,
  SectionHeader,
  Skeleton,
  StatTile,
} from "@/components/ds";
import { getShellViewer } from "@/components/shell/access";
import { Button } from "@/components/ui/button";
import { academicYearLabel, format, t } from "@/i18n";
import { getDefaultLeaderboard, getPublicCounts, type PublicCounts } from "@/lib/db";
import type { Leaderboard } from "@/lib/types";
import { cn } from "@/lib/utils";

const CONTACT_EMAIL = "fazlddn4@gmail.com";
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
      {/* Phones: hero, top students, counters in one column. Desktop: hero and top students side by side
          at equal height, the counter strip below across both. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Hero />
        <section aria-labelledby="top-title">
          <Suspense fallback={<TopStudentsSkeleton />}>
            <TopStudents />
          </Suspense>
        </section>
        <section aria-label={t.home.countersLabel} className="lg:col-span-2">
          <Suspense fallback={<CountersSkeleton />}>
            <Counters />
          </Suspense>
        </section>
      </div>

      <section aria-labelledby="categories-title" className="grid gap-4">
        <SectionHeader id="categories-title" title={t.home.categoriesTitle} />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORY_ORDER.map((code) => {
            const Icon = CATEGORY_ICONS[code];
            const { fill, ink } = CATEGORY_STYLES[code];
            return (
            <li key={code} className={cn("flex gap-4 rounded-xl p-4 sm:grid sm:content-start sm:gap-3 sm:p-5", fill)}>
              <span
                className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-raised/70", ink)}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <div className="grid content-start gap-1">
                <h3 className={cn("text-body font-semibold", ink)}>{t.categories[code]}</h3>
                <p className={cn("text-small", ink)}>{t.home.categoryText[code]}</p>
              </div>
            </li>
            );
          })}
        </ul>
      </section>

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
        className="grid justify-items-start gap-4 rounded-2xl border border-primary bg-primary-soft p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center"
      >
        <Suspense fallback={<ClosingCta viewer="guest" />}>
          <ClosingCtaForViewer />
        </Suspense>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-6 text-small text-muted-foreground">
        <span>© {t.common.appName}</span>
        <span>
          {t.home.footerContact}{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-primary-strong underline-offset-4 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </span>
      </footer>
    </div>
  );
}

function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="grid content-center gap-4 rounded-2xl bg-primary-soft p-5 sm:gap-5 sm:p-8 lg:p-10"
    >
      <h1 id="hero-title" className="text-display text-balance">
        {t.home.heroTitle}
      </h1>
      <p className="max-w-xl text-muted-foreground">{t.home.heroText}</p>
      <div className="flex flex-wrap gap-3">
        <Suspense fallback={<PrimaryAction href="/signup" label={t.home.signup} />}>
          <HeroPrimaryAction />
        </Suspense>
        <Button asChild variant="outline" size="lg">
          <Link href="/leaderboard">{t.home.toLeaderboard}</Link>
        </Button>
      </div>
    </section>
  );
}

function PrimaryAction({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild size="lg">
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

// Top 5 of the default leaderboard view (same source and order as /leaderboard): name, faculty, points.
async function TopStudents() {
  let board: Leaderboard;
  try {
    board = await getDefaultLeaderboard({});
  } catch (error) {
    console.error("load top students failed", error);
    return (
      <TopCard description={null}>
        <ErrorState message={t.home.topError} />
      </TopCard>
    );
  }
  const top = board.rows.slice(0, TOP_COUNT);
  const description =
    board.academic_year === "all"
      ? t.home.topAllTime
      : format(t.home.topYear, { year: academicYearLabel(board.academic_year) });

  return (
    <TopCard description={description}>
      {top.length === 0 ? (
        <EmptyState icon={Trophy} text={t.leaderboard.emptyAll} />
      ) : (
        <ol className="grid gap-1">
          {top.map((row) => (
            <li key={row.student_id}>
              <Link
                href={`/students/${row.student_id}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 outline-none hover:bg-primary-soft/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <RankBadge rank={row.rank} />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{row.full_name}</span>
                  {row.faculty ? <span className="truncate text-small text-muted-foreground">{row.faculty}</span> : null}
                </span>
                <span className="shrink-0 font-semibold text-primary-strong tabular">
                  {format(t.leaderboard.points, { points: row.total_points })}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </TopCard>
  );
}

function TopCard({ description, children }: { description: string | null; children: React.ReactNode }) {
  return (
    <Card className="h-full gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle id="top-title" className="text-h2">
          {t.home.topTitle}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
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
        <p className="text-muted-foreground">{viewer === "guest" ? t.home.ctaText : t.home.ctaTextMember}</p>
      </div>
      {viewer === "guest" ? (
        <PrimaryAction href="/signup" label={t.home.signup} />
      ) : viewer === "student" ? (
        <PrimaryAction href="/achievements/new" label={t.home.addAchievement} />
      ) : (
        <PrimaryAction href="/dashboard" label={t.home.toDashboard} />
      )}
    </>
  );
}

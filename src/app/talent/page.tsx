import { FileUser } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CATEGORY_ORDER, Card, CardContent, EmptyState, ErrorState, ListSkeleton, SectionHeader, TierBadge } from "@/components/ds";
import { CvFileLink } from "@/components/cv/cv-file-link";
import { checkTalentPage } from "@/components/talent-gate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { format, t, typeName } from "@/i18n";
import { listTiers, listUniversitiesWithFaculties } from "@/lib/db";
import { loadTalentList } from "@/lib/talent";
import type { TalentList } from "@/lib/types";
import { talentQuerySchema, type TalentQuery } from "@/lib/validation";

import { TalentFilters } from "./talent-filters";

export const metadata: Metadata = { title: `${t.talent.title} · ${t.common.appName}`, robots: { index: false } };

// Employers and admins only. Active students with open_to_work, tier and approved-work count; no points, rank
// or contact details (CLAUDE.md rules 5 and 11).
export default function TalentPage({ searchParams }: PageProps<"/talent">) {
  return (
    <div className="grid gap-4">
      <SectionHeader as="h1" title={t.talent.title} description={t.talent.description} />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Talent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function one(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  return typeof sp[key] === "string" ? (sp[key] as string) : undefined;
}

async function Talent({ searchParams }: { searchParams: PageProps<"/talent">["searchParams"] }) {
  const viewer = await checkTalentPage();
  const sp = await searchParams;
  const query: TalentQuery = talentQuerySchema.parse({
    faculty_id: one(sp, "faculty_id"),
    tier: one(sp, "tier"),
    category: one(sp, "category"),
    page: one(sp, "page"),
  });

  let list: TalentList;
  let faculties: { value: string; label: string }[];
  let tiers: { value: string; label: string }[];
  try {
    const [l, universities, tierRows] = await Promise.all([loadTalentList(viewer, query), listUniversitiesWithFaculties(), listTiers()]);
    list = l;
    faculties = universities.flatMap((u) => u.faculties.map((f) => ({ value: String(f.id), label: f.name })));
    tiers = tierRows.map((x) => ({ value: x.code, label: typeName(x.label) }));
  } catch (error) {
    console.error("load talent failed", error);
    return <ErrorState message={t.talent.error} />;
  }
  const categories = CATEGORY_ORDER.map((code) => ({ value: code, label: t.categories[code] ?? code }));
  const pages = Math.max(1, Math.ceil(list.total / list.page_size));

  return (
    <div className="grid gap-4">
      {viewer.role === "admin" ? (
        <Alert>
          <AlertDescription>{t.talent.adminNote}</AlertDescription>
        </Alert>
      ) : null}
      <TalentFilters
        faculties={faculties}
        tiers={tiers}
        categories={categories}
        current={{
          faculty_id: query.faculty_id ? String(query.faculty_id) : undefined,
          tier: query.tier,
          category: query.category,
        }}
      />
      <p className="text-small text-muted-foreground">{format(t.talent.count, { count: list.total })}</p>

      {list.rows.length === 0 ? (
        <EmptyState text={t.talent.empty} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.rows.map((r) => (
            <li key={r.student_id}>
              <Card className="h-full py-4">
                <CardContent className="flex h-full items-start gap-3 px-4">
                  <TierBadge tier={r.tier} size="sm" />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <Link
                      href={`/talent/${r.student_id}`}
                      className="font-medium break-words underline-offset-4 hover:text-primary-text hover:underline"
                    >
                      {r.full_name}
                    </Link>
                    <p className="text-small text-muted-foreground">
                      {[r.faculty, r.university].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-small text-muted-foreground">{format(t.talent.works, { n: r.approved_count })}</p>
                    {r.cv_available || r.cv_file_available ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {r.cv_available ? (
                          <Link
                            href={`/cv/${r.student_id}`}
                            className="inline-flex w-fit items-center gap-1.5 text-small font-medium text-primary-text underline-offset-4 hover:underline"
                          >
                            <FileUser className="size-4" aria-hidden />
                            {t.talent.openCv}
                          </Link>
                        ) : null}
                        {r.cv_file_available ? <CvFileLink studentId={r.student_id} size="small" /> : null}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? <TalentPager query={query} pages={pages} /> : null}
    </div>
  );
}

function TalentPager({ query, pages }: { query: TalentQuery; pages: number }) {
  const href = (page: number) => {
    const qs = new URLSearchParams();
    if (query.faculty_id) qs.set("faculty_id", String(query.faculty_id));
    if (query.tier) qs.set("tier", query.tier);
    if (query.category) qs.set("category", query.category);
    if (page > 1) qs.set("page", String(page));
    const s = qs.toString();
    return s ? `/talent?${s}` : "/talent";
  };
  const link = (page: number, label: string, enabled: boolean) =>
    enabled ? (
      <Button asChild variant="outline">
        <Link href={href(page)}>{label}</Link>
      </Button>
    ) : (
      <Button variant="outline" disabled>
        {label}
      </Button>
    );
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3" aria-label={t.talent.title}>
      <p className="text-small text-muted-foreground tabular">{format(t.talent.page, { page: query.page, pages })}</p>
      <div className="flex gap-2">
        {link(query.page - 1, t.talent.prev, query.page > 1)}
        {link(query.page + 1, t.talent.next, query.page < pages)}
      </div>
    </nav>
  );
}

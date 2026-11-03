import { Info } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { checkAdminPage } from "@/components/admin-gate";
import { ErrorState, ListSkeleton, SectionHeader } from "@/components/ds";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { t } from "@/i18n";
import { getRubricForAdmin, type AdminRubric } from "@/lib/db";

import { CategoryCaps } from "./category-caps";
import { PointsEditor } from "./points-editor";
import { TierEditor } from "./tier-editor";
import { TypeList } from "./type-list";

export const metadata: Metadata = { title: `${t.admin.rubric.title} · ${t.common.appName}` };

const r = t.admin.rubric;

export default function AdminRubricPage() {
  return (
    <div className="grid gap-6">
      <SectionHeader as="h1" title={r.title} description={r.description} />
      {/* Points already awarded are snapshots in reviews; edits only change future approvals. */}
      <Alert className="border-status-pending-foreground/30 bg-status-pending text-status-pending-foreground">
        <Info aria-hidden />
        <AlertDescription className="text-status-pending-foreground">{r.futureOnly}</AlertDescription>
      </Alert>
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Editor />
      </Suspense>
    </div>
  );
}

async function Editor() {
  await checkAdminPage();

  let rubric: AdminRubric;
  try {
    rubric = await getRubricForAdmin();
  } catch (error) {
    console.error("load rubric failed", error);
    return <ErrorState message={r.loadError} />;
  }

  return (
    <div className="grid gap-8">
      <section aria-labelledby="rubric-types" className="grid gap-3">
        <SectionHeader id="rubric-types" title={r.typesTitle} description={r.typesDescription} />
        <TypeList types={rubric.types} categories={rubric.categories} />
      </section>
      <section aria-labelledby="rubric-points" className="grid gap-3">
        <SectionHeader id="rubric-points" title={r.pointsTitle} description={r.pointsDescription} />
        <PointsEditor types={rubric.types} cells={rubric.cells} categories={rubric.categories} />
      </section>
      <section aria-labelledby="rubric-tiers" className="grid gap-3">
        <SectionHeader id="rubric-tiers" title={r.tiersTitle} description={r.tiersDescription} />
        <TierEditor tiers={rubric.tiers} />
      </section>
      <section aria-labelledby="rubric-caps" className="grid gap-3">
        <SectionHeader id="rubric-caps" title={r.categoriesTitle} description={r.categoriesDescription} />
        <CategoryCaps categories={rubric.categories} />
      </section>
    </div>
  );
}

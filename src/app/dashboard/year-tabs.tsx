"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { academicYearLabel, t } from "@/i18n";

// Academic year for the dashboard numbers. State lives in the URL (?year=), like the leaderboard tabs.
export function YearTabs({ years, year }: { years: number[]; year: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Tabs
      value={String(year)}
      onValueChange={(v) => startTransition(() => router.push(`/dashboard?year=${v}`, { scroll: false }))}
      className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}
    >
      <TabsList aria-label={t.dashboard.yearsLabel} className="h-auto w-full justify-start overflow-x-auto">
        {years.map((y) => (
          <TabsTrigger key={y} value={String(y)} className="flex-none px-3 py-1.5">
            {academicYearLabel(y)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";

const BASE = "/talent";
const ALL = "all";

type Option = { value: string; label: string };

// Filters live in the URL, like the admin lists. Changing a filter goes back to page 1.
export function TalentFilters({
  faculties,
  tiers,
  categories,
  current,
}: {
  faculties: Option[];
  tiers: Option[];
  categories: Option[];
  current: { faculty_id?: string; tier?: string; category?: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (value === null) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${BASE}?${qs}` : BASE, { scroll: false }));
  }

  const select = (key: "faculty_id" | "tier" | "category", label: string, options: Option[]) => (
    <div className="grid gap-2">
      <Label htmlFor={`talent-${key}`}>{label}</Label>
      <Select value={current[key] ?? ALL} onValueChange={(v) => navigate(key, v === ALL ? null : v)}>
        <SelectTrigger id={`talent-${key}`} className="w-full data-[size=default]:h-10">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t.talent.all}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const any = current.faculty_id || current.tier || current.category;
  return (
    <div
      role="search"
      aria-label={t.talent.filtersLabel}
      aria-busy={pending}
      className="grid gap-3 rounded-xl border bg-surface-raised p-4 sm:grid-cols-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end"
    >
      {select("faculty_id", t.talent.faculty, faculties)}
      {select("tier", t.talent.tier, tiers)}
      {select("category", t.talent.category, categories)}
      {any ? (
        <Button
          variant="outline"
          className="h-10 sm:col-span-3 lg:col-span-1"
          onClick={() => startTransition(() => router.push(BASE, { scroll: false }))}
        >
          {t.talent.reset}
        </Button>
      ) : null}
    </div>
  );
}

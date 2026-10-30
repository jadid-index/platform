"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, type ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { academicYearLabel, t } from "@/i18n";
import type { LeaderboardYear, University } from "@/lib/types";

const ALL = "all";

// Year tabs and university / faculty filters. State lives in the URL (?year=&university=&faculty=),
// so a filtered view can be shared. The list below dims while the next view loads.
export function LeaderboardShell({
  years,
  year,
  universities,
  universityId,
  facultyId,
  children,
}: {
  years: number[];
  year: LeaderboardYear;
  universities: University[];
  universityId?: number;
  facultyId?: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("limit");
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/?${qs}` : "/", { scroll: false }));
  }

  // With a single university (the pilot) its faculties are offered without choosing it first.
  const facultySource =
    universities.find((u) => u.id === universityId) ?? (universities.length === 1 ? universities[0] : undefined);
  const faculties = facultySource?.faculties ?? [];

  return (
    // minmax(0,1fr): the scrollable year tabs must not widen the page past the phone screen.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Tabs
        value={String(year)}
        // Always explicit: without ?year the page may fall back from an empty current year.
        onValueChange={(v) => navigate({ year: v })}
      >
        <TabsList aria-label={t.leaderboard.yearsLabel} className="h-auto w-full justify-start overflow-x-auto">
          {years.map((y) => (
            <TabsTrigger key={y} value={String(y)} className="flex-none px-3 py-1.5">
              {academicYearLabel(y)}
            </TabsTrigger>
          ))}
          <TabsTrigger value={ALL} className="flex-none px-3 py-1.5">
            {t.leaderboard.allTime}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-3 sm:grid-cols-2">
        {universities.length > 1 ? (
          <div className="grid gap-2">
            <Label htmlFor="lb-university">{t.leaderboard.university}</Label>
            <Select
              value={universityId ? String(universityId) : ALL}
              onValueChange={(v) => navigate({ university: v === ALL ? null : v, faculty: null })}
            >
              <SelectTrigger id="lb-university" className="w-full data-[size=default]:h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t.leaderboard.allUniversities}</SelectItem>
                {universities.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="lb-faculty">{t.leaderboard.faculty}</Label>
          <Select
            value={facultyId ? String(facultyId) : ALL}
            disabled={faculties.length === 0}
            onValueChange={(v) => navigate({ faculty: v === ALL ? null : v })}
          >
            <SelectTrigger id="lb-faculty" className="w-full data-[size=default]:h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t.leaderboard.allFaculties}</SelectItem>
              {faculties.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div aria-busy={pending} className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {children}
      </div>
    </div>
  );
}

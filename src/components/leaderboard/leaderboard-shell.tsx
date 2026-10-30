"use client";

import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { academicYearLabel, t } from "@/i18n";
import type { LeaderboardYear, University } from "@/lib/types";

const ALL = "all";
const BASE = "/leaderboard";
const SEARCH_DELAY_MS = 350;

// Year tabs, name search and university / faculty filters. State lives in the URL
// (?year=&q=&university=&faculty=), so a filtered view can be shared. The list dims while the next view loads.
export function LeaderboardShell({
  years,
  year,
  universities,
  universityId,
  facultyId,
  query,
  children,
}: {
  years: number[];
  year: LeaderboardYear;
  universities: University[];
  universityId?: number;
  facultyId?: number;
  query: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("limit");
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${BASE}?${qs}` : BASE, { scroll: false }));
  }

  function changeSearch(value: string) {
    setSearch(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => navigate({ q: value.trim() || null }), SEARCH_DELAY_MS);
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

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="gap-4 py-4 lg:sticky lg:top-24 lg:order-2" role="search" aria-label={t.leaderboard.filtersTitle}>
          <CardHeader className="px-4 max-lg:sr-only">
            <CardTitle className="text-body">{t.leaderboard.filtersTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 px-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="lb-search">{t.leaderboard.search}</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="lb-search"
                  type="search"
                  value={search}
                  placeholder={t.leaderboard.searchPlaceholder}
                  autoComplete="off"
                  onChange={(e) => changeSearch(e.target.value)}
                  className="h-10 bg-surface-raised pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
                />
                {search ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
                    aria-label={t.leaderboard.clearSearch}
                    onClick={() => {
                      clearTimeout(timer.current);
                      setSearch("");
                      navigate({ q: null });
                    }}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
            </div>
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
          </CardContent>
        </Card>

        <div aria-busy={pending} className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {children}
        </div>
      </div>
    </div>
  );
}

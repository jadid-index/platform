"use client";

import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { PROFILE_STATUSES, ROLES, type ProfileStatus, type Role } from "@/lib/validation";

const BASE = "/admin/users";
const ALL = "all";
const SEARCH_DELAY_MS = 300;

// Filters live in the URL, so a filtered list can be reloaded or shared between admins.
export function UserFilters({ q, role, status }: { q: string; role?: Role; status?: ProfileStatus }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("offset");
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

  return (
    <div
      role="search"
      aria-busy={pending}
      className="grid gap-3 rounded-xl border bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="admin-search">{t.admin.search}</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="admin-search"
            type="search"
            value={search}
            placeholder={t.admin.searchPlaceholder}
            autoComplete="off"
            onChange={(e) => changeSearch(e.target.value)}
            className="h-10 pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {search ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
              aria-label={t.admin.clearSearch}
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
      <div className="grid gap-2">
        <Label htmlFor="admin-role">{t.admin.filterRole}</Label>
        <Select value={role ?? ALL} onValueChange={(v) => navigate({ role: v === ALL ? null : v })}>
          <SelectTrigger id="admin-role" className="w-full data-[size=default]:h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.admin.allRoles}</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {t.admin.roles[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="admin-status">{t.admin.filterStatus}</Label>
        <Select value={status ?? ALL} onValueChange={(v) => navigate({ status: v === ALL ? null : v })}>
          <SelectTrigger id="admin-status" className="w-full data-[size=default]:h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.admin.allStatuses}</SelectItem>
            {PROFILE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t.admin.statuses[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

"use client";

import { LayoutDashboard, LogOut } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { StudentAvatar } from "@/components/student-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { createAuthClient } from "@/lib/supabase/client";

import { ThemeMenuItems } from "./theme-switch";

function useLogout(): [boolean, () => Promise<void>] {
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    await createAuthClient().auth.signOut();
    // Full page load, not a client navigation: with Cache Components, visited pages stay mounted in the
    // background with their state (the last user's data). A reload drops all of it, which also matters on shared phones.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full reload is the point
    window.location.assign("/login");
  }
  return [pending, logout];
}

// Profile menu in the top bar for signed-in users: dashboard link, theme and sign out.
export function AccountMenu({ name }: { name: string | null }) {
  const [pending, logout] = useLogout();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label={t.nav.account}>
          <StudentAvatar name={name ?? "?"} url={null} className="size-9" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {name ? <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel> : null}
        {name ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutDashboard aria-hidden />
            {t.nav.dashboard}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ThemeMenuItems />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            void logout();
          }}
        >
          <LogOut aria-hidden />
          {pending ? t.dashboard.loggingOut : t.dashboard.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The same account actions as plain buttons, for the mobile menu sheet.
export function AccountActions({ name }: { name: string | null }) {
  const [pending, logout] = useLogout();
  return (
    <div className="grid gap-2">
      {name ? (
        <div className="flex items-center gap-3 pb-1">
          <StudentAvatar name={name} url={null} className="size-9" />
          <span className="truncate font-semibold">{name}</span>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline" size="lg">
          <Link href="/dashboard">
            <LayoutDashboard aria-hidden />
            {t.nav.dashboard}
          </Link>
        </Button>
        <Button variant="outline" size="lg" disabled={pending} onClick={() => void logout()}>
          <LogOut aria-hidden />
          {pending ? t.dashboard.loggingOut : t.dashboard.logout}
        </Button>
      </div>
    </div>
  );
}

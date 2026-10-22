"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { createAuthClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await createAuthClient().auth.signOut();
    // Full page load, not a client navigation: with Cache Components, visited pages stay mounted in the
    // background with their state (this button's "pending", the last user's data). A reload drops all of it,
    // which also matters on shared phones.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full reload is the point
    window.location.assign("/login");
  }

  return (
    <Button variant="outline" size="lg" onClick={logout} disabled={pending}>
      <LogOut aria-hidden />
      {pending ? t.dashboard.loggingOut : t.dashboard.logout}
    </Button>
  );
}

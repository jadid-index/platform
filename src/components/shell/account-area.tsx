import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

import { AccountMenu } from "./account-menu";
import { getShellViewer } from "./access";

// Top-bar right side: sign-in buttons for visitors, the profile menu for signed-in users.
export async function AccountArea() {
  const viewer = await getShellViewer();
  if (viewer.kind === "guest") {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="outline">
          <Link href="/login">{t.home.login}</Link>
        </Button>
        {/* On phones the sign-up button lives in the menu drawer, so the bar fits at 375 px. */}
        <Button asChild className="hidden sm:inline-flex">
          <Link href="/signup">{t.home.signup}</Link>
        </Button>
      </div>
    );
  }
  return <AccountMenu name={viewer.kind === "member" ? viewer.name : null} />;
}

// Sign-up and sign-in at the bottom of the mobile drawer, for visitors only.
export async function DrawerAuthLinks() {
  const viewer = await getShellViewer();
  if (viewer.kind !== "guest") return null;
  return (
    <div className="grid gap-2">
      <Button asChild size="lg">
        <Link href="/signup">{t.home.signup}</Link>
      </Button>
      <Button asChild variant="outline" size="lg">
        <Link href="/login">{t.home.login}</Link>
      </Button>
    </div>
  );
}

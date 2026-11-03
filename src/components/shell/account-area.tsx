import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

import { AccountActions, AccountMenu } from "./account-menu";
import { getShellViewer } from "./access";

// Pill right side (lg and up): sign-in buttons for visitors, the profile menu for signed-in users.
export async function AccountArea() {
  const viewer = await getShellViewer();
  if (viewer.kind === "guest") {
    return (
      <div className="flex items-center gap-1.5">
        <Button asChild variant="ghost" className="rounded-full">
          <Link href="/login">{t.home.login}</Link>
        </Button>
        <Button asChild className="rounded-full">
          <Link href="/signup">{t.home.signup}</Link>
        </Button>
      </div>
    );
  }
  return <AccountMenu name={viewer.kind === "member" ? viewer.name : null} />;
}

// The account part of the mobile menu sheet: sign-up and sign-in, or the profile actions.
export async function SheetAccount() {
  const viewer = await getShellViewer();
  if (viewer.kind !== "guest") return <AccountActions name={viewer.kind === "member" ? viewer.name : null} />;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button asChild size="lg">
        <Link href="/signup">{t.home.signup}</Link>
      </Button>
      <Button asChild variant="outline" size="lg">
        <Link href="/login">{t.home.login}</Link>
      </Button>
    </div>
  );
}

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <div className="grid gap-2">
        <h1 className="text-3xl font-semibold text-primary-strong">{t.common.appName}</h1>
        <p className="text-muted-foreground">{t.home.tagline}</p>
      </div>
      <div className="grid w-full max-w-xs gap-3">
        <Button asChild size="lg">
          <Link href="/signup">{t.home.signup}</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/login">{t.home.login}</Link>
        </Button>
      </div>
    </main>
  );
}

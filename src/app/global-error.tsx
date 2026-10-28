"use client";

import "./globals.css";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

// Last-resort boundary when the root layout itself fails. It replaces the layout, so it renders its own document.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="uz">
      <body className="bg-background text-foreground antialiased">
        <main className="mx-auto grid w-full max-w-md gap-3 px-4 py-10">
          <title>{t.common.appName}</title>
          <p role="alert">{t.common.genericError}</p>
          <Button variant="outline" onClick={() => retry()}>
            {t.common.retry}
          </Button>
        </main>
      </body>
    </html>
  );
}

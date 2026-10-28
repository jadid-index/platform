"use client";

import { AlertCircle } from "lucide-react";
import { useEffect } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

// Error boundary for every page under the root layout. Shows a translated message, never the error itself.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto grid w-full max-w-md gap-3 px-4 py-10">
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertDescription>{t.common.genericError}</AlertDescription>
      </Alert>
      <Button variant="outline" onClick={() => retry()}>
        {t.common.retry}
      </Button>
    </main>
  );
}

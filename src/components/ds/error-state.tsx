"use client";

import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

// Load failure with a retry that re-runs the server components.
export function ErrorState({ message = t.common.genericError }: { message?: string }) {
  const router = useRouter();
  return (
    <div className="grid gap-3">
      <Alert variant="destructive">
        <AlertCircle aria-hidden />
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button variant="outline" className="w-fit" onClick={() => router.refresh()}>
        {t.common.retry}
      </Button>
    </div>
  );
}

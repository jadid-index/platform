"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { format, t } from "@/i18n";

// Runs the uploaded-CV cleanup (POST /api/admin/cv-files/cleanup): deletes CV objects that are not a student's
// current file, such as uploads never finished within an hour. Safe to press any time.
export function CvCleanup() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [removed, setRemoved] = useState(0);

  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/admin/cv-files/cleanup", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setRemoved(((await res.json()) as { removed: number }).removed);
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-h2">{t.admin.cvCleanupTitle}</CardTitle>
        <CardDescription>{t.admin.cvCleanupText}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3 px-5">
        <Button variant="outline" onClick={run} disabled={state === "running"}>
          <Trash2 aria-hidden />
          {state === "running" ? t.admin.cvCleanupRunning : t.admin.cvCleanupButton}
        </Button>
        <p className="text-small" role="status" aria-live="polite">
          {state === "done" ? <span className="text-primary-text">{format(t.admin.cvCleanupDone, { n: removed })}</span> : null}
          {state === "error" ? <span className="text-destructive">{t.admin.cvCleanupError}</span> : null}
        </p>
      </CardContent>
    </Card>
  );
}

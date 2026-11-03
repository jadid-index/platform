"use client";

import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";

// Saved at once through PATCH /api/review/submissions/:id/sensitive. A flagged file stays private for good:
// only the owner, reviewers and admins can open it (set_sensitive_flag() also makes it private).
export function SensitiveFlag({ submissionId, initial, disabled }: { submissionId: string; initial: boolean; disabled?: boolean }) {
  const [flag, setFlag] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(next: boolean) {
    const previous = flag;
    setFlag(next);
    setState("saving");
    try {
      const res = await fetch(`/api/review/submissions/${submissionId}/sensitive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flag: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("saved");
    } catch {
      setFlag(previous);
      setState("error");
    }
  }

  return (
    <div className="grid gap-1.5 rounded-xl border bg-surface-sunken p-3">
      <div className="flex items-start gap-3">
        <Checkbox
          id="sensitive-flag"
          className="mt-0.5"
          checked={flag}
          disabled={disabled || state === "saving"}
          onCheckedChange={(checked) => save(checked === true)}
          aria-describedby="sensitive-flag-hint"
        />
        <Label htmlFor="sensitive-flag" className="leading-snug font-medium">
          {t.review.sensitiveLabel}
        </Label>
      </div>
      <p id="sensitive-flag-hint" className="pl-7 text-small text-muted-foreground">
        {t.review.sensitiveHint}
      </p>
      <p className="pl-7 text-small" role="status" aria-live="polite">
        {state === "saved" ? <span className="text-primary-text">{t.review.sensitiveSaved}</span> : null}
        {state === "error" ? <span className="text-destructive">{t.review.sensitiveError}</span> : null}
      </p>
    </div>
  );
}

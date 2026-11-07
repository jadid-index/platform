"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";

// The student's opt-in to the employers' talent directory. Saved at once (PATCH /api/me/open-to-work), then the
// page refreshes so the hero status and the employer preview follow.
export function OpenToWorkControl({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  async function change(next: boolean) {
    const previous = value;
    setValue(next);
    setState("saving");
    try {
      const res = await fetch("/api/me/open-to-work", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open_to_work: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("idle");
      router.refresh();
    } catch {
      setValue(previous);
      setState("error");
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="open-to-work" className="text-body font-semibold">
          {t.openToWork.label}
        </Label>
        <Switch
          id="open-to-work"
          checked={value}
          disabled={state === "saving"}
          aria-describedby="open-to-work-state open-to-work-explain"
          onCheckedChange={change}
        />
      </div>
      <p id="open-to-work-state" className="text-small font-medium" role="status" aria-live="polite">
        {state === "saving" ? t.openToWork.saving : state === "error" ? (
          <span className="text-destructive">{t.openToWork.error}</span>
        ) : value ? (
          <span className="text-primary-text">{t.openToWork.on}</span>
        ) : (
          <span className="text-muted-foreground">{t.openToWork.off}</span>
        )}
      </p>
      <p id="open-to-work-explain" className="text-small text-muted-foreground">
        {t.openToWork.explain}
      </p>
    </div>
  );
}

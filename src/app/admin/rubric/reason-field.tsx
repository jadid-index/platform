"use client";

import { AlertCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";

// Every rubric change needs a short reason; it is stored in the audit log with the old and new values.
export function ReasonField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{t.admin.rubric.reason}</Label>
      <Input
        id={id}
        value={value}
        maxLength={200}
        placeholder={t.admin.rubric.reasonPlaceholder}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className="h-10"
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t.admin.rubric.reasonHint}
      </p>
    </div>
  );
}

export function SaveError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="inline-flex items-start gap-1.5 text-small text-destructive">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

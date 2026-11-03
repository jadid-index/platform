"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { t } from "@/i18n";

// Sends one change to /api/admin/rubric/... and re-renders the page from the server on success.
// The server re-checks everything; errors come back as stable codes mapped to translated messages.
export function useSave() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function send(url: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body: unknown): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(t.admin.rubric.errors[data.error ?? ""] ?? t.admin.rubric.errors.server_error);
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      setError(t.admin.rubric.errors.server_error);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { send, saving, error, setError };
}

export const validReason = (reason: string) => reason.trim().length >= 3 && reason.trim().length <= 200;

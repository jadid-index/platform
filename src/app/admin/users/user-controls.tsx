"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, t } from "@/i18n";
import type { AdminUser } from "@/lib/db";
import { ADMIN_SETTABLE_STATUSES, ROLES } from "@/lib/validation";

// Role and status for one user. Each change is one PATCH; the server checks the admin, protects the last admin
// and writes the audit row. The list re-renders from the server afterwards.
export function UserControls({ user }: { user: Pick<AdminUser, "id" | "full_name" | "role" | "status"> }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const legacyStatus = !ADMIN_SETTABLE_STATUSES.includes(user.status as (typeof ADMIN_SETTABLE_STATUSES)[number]);

  async function save(change: { role: string } | { status: string }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(t.admin.errors[body.error ?? ""] ?? t.admin.errors.server_error);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError(t.admin.errors.server_error);
    } finally {
      setSaving(false);
    }
  }

  const roleId = `role-${user.id}`;
  const statusId = `status-${user.id}`;

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2 lg:w-80">
        <div className="grid gap-1">
          <Label htmlFor={roleId} className="text-xs text-muted-foreground">
            {t.admin.colRole}
          </Label>
          <Select value={user.role} disabled={saving} onValueChange={(v) => save({ role: v })}>
            <SelectTrigger
              id={roleId}
              aria-label={format(t.admin.roleFor, { name: user.full_name })}
              className="w-full data-[size=default]:h-9"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t.admin.roles[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={statusId} className="text-xs text-muted-foreground">
            {t.admin.colStatus}
          </Label>
          <Select value={user.status} disabled={saving} onValueChange={(v) => save({ status: v })}>
            <SelectTrigger
              id={statusId}
              aria-label={format(t.admin.statusFor, { name: user.full_name })}
              className="w-full data-[size=default]:h-9"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADMIN_SETTABLE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t.admin.statuses[s]}
                </SelectItem>
              ))}
              {legacyStatus ? (
                <SelectItem value={user.status} disabled>
                  {t.admin.statuses[user.status]} ({t.admin.legacyStatus})
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div aria-live="polite" className="min-h-0 text-small">
        {saving ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t.admin.saving}
          </span>
        ) : error ? (
          <span role="alert" className="inline-flex items-start gap-1.5 text-destructive lg:max-w-80">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

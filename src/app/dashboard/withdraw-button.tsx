"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

// Two-step inline confirmation (no browser dialog), then POST /api/submissions/:id/withdraw.
export function WithdrawButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/withdraw`, { method: "POST" });
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
        setError(code === "not_pending" ? t.errors.notPending : t.common.genericError);
        return;
      }
      router.refresh();
    } catch {
      setError(t.common.genericError);
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="grid gap-2">
      {confirming ? (
        <>
          <p className="text-sm">{t.dashboard.withdrawConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={withdraw} disabled={pending}>
              {pending ? t.dashboard.withdrawing : t.dashboard.withdrawConfirmYes}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              {t.dashboard.withdrawCancel}
            </Button>
          </div>
        </>
      ) : (
        <Button variant="outline" className="w-fit" onClick={() => setConfirming(true)}>
          {t.dashboard.withdraw}
        </Button>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

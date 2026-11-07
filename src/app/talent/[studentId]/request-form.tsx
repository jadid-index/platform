"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format, t } from "@/i18n";
import { CONTACT_MESSAGE_MAX } from "@/lib/validation";

// Sends one contact request (POST /api/talent/requests). The server enforces the limits and the cooldown.
export function RequestForm({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (text.length < 1 || text.length > CONTACT_MESSAGE_MAX) {
      setInvalid(true);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/talent/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId, message: text }),
      });
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
        setError((code && t.talent.errors[code]) || t.common.genericError);
        return;
      }
      setSent(true);
      router.refresh();
    } catch {
      setError(t.common.genericError);
    } finally {
      setSending(false);
    }
  }

  if (sent) return <p className="text-small text-primary-text" role="status">{t.talent.sent}</p>;

  return (
    <form className="grid gap-3" noValidate onSubmit={onSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="request-message">{t.talent.message}</Label>
        <Textarea
          id="request-message"
          rows={5}
          maxLength={CONTACT_MESSAGE_MAX}
          value={message}
          placeholder={t.talent.messagePlaceholder}
          disabled={sending}
          aria-invalid={invalid}
          aria-describedby="request-message-count"
          onChange={(e) => {
            setMessage(e.target.value);
            setInvalid(false);
          }}
        />
        <p id="request-message-count" className="text-small text-muted-foreground tabular">
          {invalid ? (
            <span className="text-destructive">{t.talent.messageInvalid}</span>
          ) : (
            format(t.talent.messageCount, { n: message.length, max: CONTACT_MESSAGE_MAX })
          )}
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-fit" disabled={sending}>
        {sending ? t.talent.sending : t.talent.send}
      </Button>
    </form>
  );
}

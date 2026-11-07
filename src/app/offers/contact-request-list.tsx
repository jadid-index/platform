"use client";

import { BadgeCheck, CircleHelp, Handshake } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card, CardContent, Chip, EmptyState } from "@/components/ds";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { format, formatDate, t } from "@/i18n";
import type { StudentContactRequest } from "@/lib/types";
import { CONTACT_KINDS, emailSchema, PHONE_RE, TELEGRAM_RE, type ContactKind } from "@/lib/validation";

const STATUS_TONE = { pending: "pending", accepted: "approved", declined: "muted" } as const;

function validContact(kind: ContactKind, value: string): boolean {
  const v = value.trim();
  if (kind === "phone") return PHONE_RE.test(v);
  if (kind === "telegram") return TELEGRAM_RE.test(v);
  return emailSchema.safeParse(v).success;
}

function errorText(code: string | undefined): string {
  return (code && (t.contactRequests.errors[code] ?? t.talent.errors[code])) || t.common.genericError;
}

// Received contact requests, new ones first. No email is sent (rule 6), so this list is the student's inbox.
export function ContactRequestList({
  rows,
  accountEmail,
  openToWork,
}: {
  rows: StudentContactRequest[];
  accountEmail: string | null;
  openToWork: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Handshake}
        text={t.contactRequests.empty}
        hint={openToWork ? undefined : t.offers.emptyHintOff}
      />
    );
  }
  const pending = rows.filter((r) => r.status === "pending");
  const answered = rows.filter((r) => r.status !== "pending");
  return (
    <div className="grid gap-6">
      {pending.length > 0 ? (
        <RequestGroup id="requests-new" title={t.offers.groupNew} rows={pending} accountEmail={accountEmail} />
      ) : null}
      {answered.length > 0 ? (
        <RequestGroup id="requests-answered" title={t.offers.groupAnswered} rows={answered} accountEmail={accountEmail} />
      ) : null}
    </div>
  );
}

function RequestGroup({
  id,
  title,
  rows,
  accountEmail,
}: {
  id: string;
  title: string;
  rows: StudentContactRequest[];
  accountEmail: string | null;
}) {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h3 id={id} className="flex items-center gap-2 text-small font-semibold text-muted-foreground">
        {title}
        <span className="tabular">· {rows.length}</span>
      </h3>
      <ul className="grid gap-3">
        {rows.map((r) => (
          <li key={r.id}>
            <RequestCard request={r} accountEmail={accountEmail} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequestCard({ request: r, accountEmail }: { request: StudentContactRequest; accountEmail: string | null }) {
  const router = useRouter();
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [kind, setKind] = useState<ContactKind>("telegram");
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(body: Record<string, string>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/contact-requests/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
        setError(errorText(code));
        return;
      }
      setDialogOpen(false);
      setConfirmDecline(false);
      router.refresh();
    } catch {
      setError(t.common.genericError);
    } finally {
      setSaving(false);
    }
  }

  function chooseKind(next: ContactKind) {
    setKind(next);
    setInvalid(false);
    setValue(next === "email" ? (accountEmail ?? "") : "");
  }

  function share() {
    if (!validContact(kind, value)) {
      setInvalid(true);
      return;
    }
    void respond({ action: "accept", kind, value: value.trim() });
  }

  const company = r.company_name ?? t.contactRequests.unknownCompany;
  const isPending = r.status === "pending";
  return (
    <Card className={cn("gap-3 py-4", isPending && "border-primary shadow-raised")}>
      <CardContent className="grid gap-3 px-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-body font-extrabold text-primary-strong"
          >
            {company.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="font-semibold break-words">{company}</p>
              <Chip tone={STATUS_TONE[r.status]}>{t.contactRequests.statuses[r.status]}</Chip>
            </div>
            {r.contact_person ? <p className="text-small break-words">{r.contact_person}</p> : null}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {r.employer_verified ? (
                  <BadgeCheck className="size-4 text-primary-text" aria-hidden />
                ) : (
                  <CircleHelp className="size-4" aria-hidden />
                )}
                {r.employer_verified ? t.contactRequests.verified : t.contactRequests.unverified}
              </span>
              <span className="tabular">{format(t.contactRequests.receivedOn, { date: formatDate(r.created_at) })}</span>
            </p>
          </div>
        </div>
        <blockquote className="rounded-xl border-l-4 border-border-strong bg-surface-sunken px-4 py-3 text-small break-words whitespace-pre-line">
          {r.message}
        </blockquote>

        {r.status === "accepted" && r.shared_contact_kind ? (
          <p className="text-small text-primary-text">
            {format(t.contactRequests.acceptedShared, { kind: t.talent.contactKinds[r.shared_contact_kind] })}
          </p>
        ) : null}
        {r.status === "declined" && r.responded_at ? (
          <p className="text-small text-muted-foreground">
            {format(t.contactRequests.declinedOn, { date: formatDate(r.responded_at) })}
          </p>
        ) : null}

        {r.status === "pending" ? (
          confirmDecline ? (
            <div className="grid gap-2">
              <p className="text-sm">{t.contactRequests.declineConfirm}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" disabled={saving} onClick={() => respond({ action: "decline" })}>
                  {saving ? t.contactRequests.saving : t.contactRequests.declineYes}
                </Button>
                <Button variant="outline" disabled={saving} onClick={() => setConfirmDecline(false)}>
                  {t.contactRequests.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDialogOpen(true)}>{t.contactRequests.accept}</Button>
              <Button variant="outline" onClick={() => setConfirmDecline(true)}>
                {t.contactRequests.decline}
              </Button>
            </div>
          )
        ) : null}
        {error && !dialogOpen ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => !saving && setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.contactRequests.acceptTitle}</DialogTitle>
            <DialogDescription>{t.contactRequests.acceptHint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t.contactRequests.kindLabel}</legend>
              <RadioGroup value={kind} onValueChange={(v) => chooseKind(v as ContactKind)} className="gap-2" disabled={saving}>
                {CONTACT_KINDS.map((k) => (
                  <div key={k} className="flex items-center gap-3">
                    <RadioGroupItem value={k} id={`${r.id}-${k}`} />
                    <Label htmlFor={`${r.id}-${k}`} className="font-normal">
                      {t.talent.contactKinds[k]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
            <div className="grid gap-2">
              <Label htmlFor={`${r.id}-value`}>{t.contactRequests.valueLabel}</Label>
              <Input
                id={`${r.id}-value`}
                className="h-10"
                type={kind === "email" ? "email" : kind === "phone" ? "tel" : "text"}
                value={value}
                placeholder={t.contactRequests.placeholders[kind]}
                disabled={saving}
                aria-invalid={invalid}
                aria-describedby={invalid ? `${r.id}-value-message` : undefined}
                onChange={(e) => {
                  setValue(e.target.value);
                  setInvalid(false);
                }}
              />
              {invalid ? (
                <p id={`${r.id}-value-message`} className="text-sm text-destructive">
                  {t.contactRequests.valueInvalid[kind]}
                </p>
              ) : null}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>
              {t.contactRequests.cancel}
            </Button>
            <Button disabled={saving} onClick={share}>
              {saving ? t.contactRequests.saving : t.contactRequests.share}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

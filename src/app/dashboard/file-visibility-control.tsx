"use client";

import { ExternalLink, FileText, Lock } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { t } from "@/i18n";
import { fileHref } from "@/lib/file-access";
import { FILE_VISIBILITIES, type FileVisibility } from "@/lib/types";

const ERRORS: Record<string, string> = {
  sensitive_locked: t.errors.sensitiveLocked,
  confirmation_required: t.errors.confirmationRequired,
  not_approved: t.errors.notApproved,
  rate_limited: t.errors.rateLimited,
};

// Who may open the document of one approved work. 'public' needs the confirmation dialog (preview plus a required
// checkbox); going back to 'private' or 'verified' saves at once. A reviewer's sensitive flag locks it to private.
export function FileVisibilityControl({
  submissionId,
  initial,
  locked,
}: {
  submissionId: string;
  initial: FileVisibility;
  locked: boolean;
}) {
  const id = useId();
  const [value, setValue] = useState<FileVisibility>(locked ? "private" : initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function save(next: FileVisibility, confirm = false): Promise<boolean> {
    setState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirm ? { visibility: next, confirm: true } : { visibility: next }),
      });
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
        setError((code && ERRORS[code]) ?? t.files.error);
        setState("error");
        return false;
      }
      setValue(next);
      setState("saved");
      return true;
    } catch {
      setError(t.files.error);
      setState("error");
      return false;
    }
  }

  function choose(next: string) {
    const v = FILE_VISIBILITIES.find((x) => x === next);
    if (!v || v === value) return;
    if (v === "public") {
      setConfirmed(false);
      setDialogOpen(true);
      return;
    }
    void save(v);
  }

  async function confirmPublic() {
    if (await save("public", true)) setDialogOpen(false);
  }

  if (locked) {
    return (
      <div className="flex items-start gap-2 rounded-lg border bg-surface-sunken p-3 text-small">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="grid gap-2">
          <p>{t.files.locked}</p>
          <DocumentLink submissionId={submissionId} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-surface-sunken p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-title`} className="text-small font-semibold">
          {t.files.visibilityTitle}
        </p>
        <DocumentLink submissionId={submissionId} />
      </div>
      <RadioGroup
        aria-labelledby={`${id}-title`}
        value={value}
        onValueChange={choose}
        disabled={state === "saving"}
        className="gap-2"
      >
        {FILE_VISIBILITIES.map((v) => (
          <div key={v} className="flex items-start gap-3">
            <RadioGroupItem value={v} id={`${id}-${v}`} className="mt-0.5" aria-describedby={`${id}-${v}-help`} />
            <div className="grid gap-0.5">
              <Label htmlFor={`${id}-${v}`} className="leading-snug font-medium">
                {t.files.visibility[v]}
              </Label>
              <p id={`${id}-${v}-help`} className="text-small text-muted-foreground">
                {t.files.visibilityHelp[v]}
              </p>
            </div>
          </div>
        ))}
      </RadioGroup>
      <p className="text-small text-muted-foreground">{t.files.alwaysPublic}</p>
      <p className="text-small" role="status" aria-live="polite">
        {state === "saving" ? <span className="text-muted-foreground">{t.files.saving}</span> : null}
        {state === "saved" ? <span className="text-primary-text">{t.files.saved}</span> : null}
        {state === "error" && !dialogOpen ? <span className="text-destructive">{error}</span> : null}
      </p>

      <Dialog open={dialogOpen} onOpenChange={(open) => state !== "saving" && setDialogOpen(open)}>
        <DialogContent className="sm:max-w-2xl" closeLabel={t.files.cancel}>
          <DialogHeader>
            <DialogTitle>{t.files.publicTitle}</DialogTitle>
            <DialogDescription>{t.files.publicText}</DialogDescription>
          </DialogHeader>
          {dialogOpen ? <Preview submissionId={submissionId} /> : null}
          <div className="flex items-start gap-3 rounded-lg border bg-surface-sunken p-3">
            <Checkbox
              id={`${id}-confirm`}
              className="mt-0.5"
              checked={confirmed}
              onCheckedChange={(c) => setConfirmed(c === true)}
            />
            <Label htmlFor={`${id}-confirm`} className="leading-snug font-normal">
              {t.files.confirmCheckbox}
            </Label>
          </div>
          {state === "error" && error ? <p className="text-small text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={state === "saving"}>
              {t.files.cancel}
            </Button>
            <Button onClick={confirmPublic} disabled={!confirmed || state === "saving"}>
              {state === "saving" ? t.files.saving : t.files.confirmPublic}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentLink({ submissionId }: { submissionId: string }) {
  return (
    <a
      href={fileHref(submissionId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-small font-medium text-primary-text underline-offset-4 hover:underline"
    >
      <FileText className="size-4" aria-hidden />
      {t.files.viewDocument}
    </a>
  );
}

// The file through /api/files (owner: always allowed). An iframe shows both PDFs and images.
function Preview({ submissionId }: { submissionId: string }) {
  return (
    <div className="grid gap-2">
      <iframe
        src={fileHref(submissionId)}
        title={t.files.previewLabel}
        className="h-[55dvh] w-full rounded-lg border bg-surface-raised"
        referrerPolicy="no-referrer"
      />
      <a
        href={fileHref(submissionId)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit items-center gap-1.5 text-small font-medium text-primary-text underline-offset-4 hover:underline"
      >
        <ExternalLink className="size-4" aria-hidden />
        {t.files.openInTab}
      </a>
    </div>
  );
}

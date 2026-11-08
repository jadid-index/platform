"use client";

import { Check, EyeOff } from "lucide-react";
import { useId, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ds";
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
import { CV_VISIBILITIES, type CvVisibility } from "@/lib/types";

// Who may open the CV. 'public' needs the confirmation dialog (what becomes public, a required checkbox);
// going back to 'private' or 'verified' saves at once. Contacts are never public (rule 12).
export function CvVisibilityControl({ initial }: { initial: CvVisibility }) {
  const id = useId();
  const [value, setValue] = useState<CvVisibility>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function save(next: CvVisibility, confirm = false): Promise<boolean> {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/me/cv/visibility", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirm ? { visibility: next, confirm: true } : { visibility: next }),
      });
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
        setError((code && t.cv.errors[code]) ?? t.cv.saveError);
        setState("error");
        return false;
      }
      setValue(next);
      setState("saved");
      return true;
    } catch {
      setError(t.cv.saveError);
      setState("error");
      return false;
    }
  }

  function choose(next: string) {
    const v = CV_VISIBILITIES.find((x) => x === next);
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

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle id={`${id}-title`} className="text-h2">
          {t.cv.visibilityTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-5">
        <RadioGroup
          aria-labelledby={`${id}-title`}
          value={value}
          onValueChange={choose}
          disabled={state === "saving"}
          className="gap-3"
        >
          {CV_VISIBILITIES.map((v) => (
            <div key={v} className="flex items-start gap-3">
              <RadioGroupItem value={v} id={`${id}-${v}`} className="mt-0.5" aria-describedby={`${id}-${v}-help`} />
              <div className="grid gap-0.5">
                <Label htmlFor={`${id}-${v}`} className="leading-snug font-medium">
                  {t.cv.visibility[v]}
                </Label>
                <p id={`${id}-${v}-help`} className="text-small text-muted-foreground">
                  {t.cv.visibilityHelp[v]}
                </p>
              </div>
            </div>
          ))}
        </RadioGroup>
        <p className="text-small text-muted-foreground">{t.cv.acceptedNote}</p>
        <p className="text-small" role="status" aria-live="polite">
          {state === "saving" ? <span className="text-muted-foreground">{t.cv.saving}</span> : null}
          {state === "saved" ? <span className="text-primary-text">{t.cv.saved}</span> : null}
          {state === "error" && !dialogOpen ? <span className="text-destructive">{error}</span> : null}
        </p>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => state !== "saving" && setDialogOpen(open)}>
        <DialogContent className="sm:max-w-lg" closeLabel={t.cv.cancel}>
          <DialogHeader>
            <DialogTitle>{t.cv.publicTitle}</DialogTitle>
            <DialogDescription>{t.cv.publicText}</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2 text-small">
            {t.cv.publicShown.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
            <li className="flex items-start gap-2">
              <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="font-medium">{t.cv.publicHidden}</span>
            </li>
          </ul>
          <div className="flex items-start gap-3 rounded-lg border bg-surface-sunken p-3">
            <Checkbox
              id={`${id}-confirm`}
              className="mt-0.5"
              checked={confirmed}
              onCheckedChange={(c) => setConfirmed(c === true)}
            />
            <Label htmlFor={`${id}-confirm`} className="leading-snug font-normal">
              {t.cv.confirmCheckbox}
            </Label>
          </div>
          {state === "error" && error ? <p className="text-small text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={state === "saving"}>
              {t.cv.cancel}
            </Button>
            <Button onClick={confirmPublic} disabled={!confirmed || state === "saving"}>
              {state === "saving" ? t.cv.saving : t.cv.confirmPublic}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

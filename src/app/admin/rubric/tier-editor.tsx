"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { Card, CardContent, EmptyState, TierBadge } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { format, t, typeName } from "@/i18n";
import type { Tier } from "@/lib/types";
import { TIER_CODE, TIER_MIN_MAX } from "@/lib/validation";

import { ReasonField, SaveError } from "./reason-field";
import { useSave, validReason } from "./use-save";

const r = t.admin.rubric;

type Editing = { mode: "create" } | { mode: "edit"; tier: Tier } | { mode: "delete"; tier: Tier };

// Tiers, best first. Thresholds decide the order; sort_order is renumbered in SQL after every change.
export function TierEditor({ tiers }: { tiers: Tier[] }) {
  const [editing, setEditing] = useState<Editing | null>(null);

  return (
    <div className="grid gap-3">
      <p className="text-small text-muted-foreground">{r.tiersLive}</p>
      <div>
        <Button onClick={() => setEditing({ mode: "create" })}>
          <Plus aria-hidden />
          {r.addTier}
        </Button>
      </div>
      {tiers.length === 0 ? (
        <EmptyState text={r.tiersEmpty} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label={r.tiersCaption}>
          {tiers.map((tier) => (
            <li key={tier.code}>
              <Card className="gap-2 py-3">
                <CardContent className="flex items-center gap-3 px-3">
                  <TierBadge tier={tier} />
                  <div className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{typeName(tier.label)}</span>
                    <span className="text-small text-muted-foreground tabular">
                      {r.tierMin}: {tier.min_points} · {r.tierOrder}: {tier.sort_order}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`${r.editTier}: ${tier.code}`} onClick={() => setEditing({ mode: "edit", tier })}>
                    <Pencil aria-hidden />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={editing !== null} onOpenChange={(open) => (!open ? setEditing(null) : undefined)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {editing ? (
            <TierForm
              key={editing.mode === "create" ? "new" : `${editing.mode}-${editing.tier.code}`}
              editing={editing}
              onDelete={(tier) => setEditing({ mode: "delete", tier })}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TierForm({ editing, onDone, onDelete }: { editing: Editing; onDone: () => void; onDelete: (tier: Tier) => void }) {
  const tier = editing.mode === "create" ? null : editing.tier;
  const [code, setCode] = useState(tier?.code ?? "");
  const [label, setLabel] = useState(tier?.label.uz ?? "");
  const [min, setMin] = useState(tier ? String(tier.min_points) : "");
  const [reason, setReason] = useState("");
  const { send, saving, error, setError } = useSave();

  const minValue = Number(min);
  const minValid = min.trim() !== "" && Number.isInteger(minValue) && minValue >= 1 && minValue <= TIER_MIN_MAX;
  const url = tier ? `/api/admin/tiers/${encodeURIComponent(tier.code)}` : "/api/admin/tiers";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validReason(reason)) return setError(r.errors.reason_required);
    if (editing.mode === "delete") {
      if (await send(url, "DELETE", { reason })) onDone();
      return;
    }
    if (!TIER_CODE.test(code.trim())) return setError(r.errors.invalid_tier_code);
    if (!label.trim()) return setError(r.errors.name_required);
    if (!minValid) return setError(r.errors.points_out_of_range);
    const body = {
      code: code.trim(),
      label: { uz: label.trim(), ...(tier?.label.en ? { en: tier.label.en } : {}), ...(tier?.label.ru ? { ru: tier.label.ru } : {}) },
      min_points: minValue,
      reason,
    };
    if (await send(url, tier ? "PATCH" : "POST", body)) onDone();
  }

  if (editing.mode === "delete") {
    return (
      <>
        <SheetHeader>
          <SheetTitle>
            {r.deleteTier}: {editing.tier.code}
          </SheetTitle>
          <SheetDescription>{r.tiersLive}</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="grid gap-4 px-4 pb-6">
          <ReasonField id="tier-delete-reason" value={reason} onChange={setReason} />
          <SaveError message={error} />
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={saving} className="flex-1 sm:flex-none">
              {saving ? t.admin.saving : r.confirmAction}
            </Button>
            <Button type="button" variant="outline" onClick={onDone} className="flex-1 sm:flex-none">
              {r.cancel}
            </Button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{tier ? r.editTier : r.newTier}</SheetTitle>
        <SheetDescription>{r.tiersLive}</SheetDescription>
      </SheetHeader>
      <form onSubmit={submit} className="grid gap-4 px-4 pb-6">
        <div className="grid gap-1.5">
          <Label htmlFor="tier-code">{r.tierCode}</Label>
          <Input id="tier-code" value={code} maxLength={8} aria-describedby="tier-code-hint" onChange={(e) => setCode(e.target.value)} className="h-10" />
          <p id="tier-code-hint" className="text-xs text-muted-foreground">
            {r.tierCodeHint}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tier-label">{r.tierLabel}</Label>
          <Input id="tier-label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="h-10" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tier-min">{r.tierMin}</Label>
          <Input
            id="tier-min"
            type="number"
            inputMode="numeric"
            min={1}
            max={TIER_MIN_MAX}
            step={1}
            value={min}
            aria-invalid={min !== "" && !minValid}
            aria-describedby="tier-min-hint"
            onChange={(e) => setMin(e.target.value)}
            className="h-10 tabular"
          />
          <p id="tier-min-hint" className="text-xs text-muted-foreground">
            {format(r.tierMinHint, { max: TIER_MIN_MAX })}
          </p>
        </div>
        <ReasonField id="tier-reason" value={reason} onChange={setReason} />
        <SaveError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving} className="flex-1 sm:flex-none">
            {saving ? t.admin.saving : r.save}
          </Button>
          <Button type="button" variant="outline" onClick={onDone} className="flex-1 sm:flex-none">
            {r.cancel}
          </Button>
          {tier ? (
            <Button type="button" variant="ghost" className="text-destructive" onClick={() => onDelete(tier)}>
              {r.deleteTier}
            </Button>
          ) : null}
        </div>
      </form>
    </>
  );
}

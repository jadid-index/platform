"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { format, t } from "@/i18n";
import type { AdminCategory, AdminType } from "@/lib/db";

import { ReasonField, SaveError } from "./reason-field";
import { useSave, validReason } from "./use-save";

const r = t.admin.rubric;

// Create (type = null) or edit one achievement type. Ranges are checked again in SQL against the current cap.
export function TypeSheet({
  open,
  onOpenChange,
  type,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: AdminType | null;
  categories: AdminCategory[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{type ? r.editType : r.newType}</SheetTitle>
          <SheetDescription>{r.futureOnly}</SheetDescription>
        </SheetHeader>
        {/* Remount per type, so the form starts from that type's values. */}
        {open ? (
          <TypeForm key={type?.id ?? "new"} type={type} categories={categories} onDone={() => onOpenChange(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function TypeForm({ type, categories, onDone }: { type: AdminType | null; categories: AdminCategory[]; onDone: () => void }) {
  const [nameUz, setNameUz] = useState(type?.name.uz ?? "");
  const [nameEn, setNameEn] = useState(type?.name.en ?? "");
  const [category, setCategory] = useState(type?.category_code ?? categories[0]?.code ?? "");
  const [base, setBase] = useState(type ? String(type.base_points) : "");
  const [placement, setPlacement] = useState(type?.has_placement ?? false);
  const [hint, setHint] = useState(type?.proof_hint ?? "");
  const [certRequired, setCertRequired] = useState(type?.certificate_ref_required ?? false);
  const [reason, setReason] = useState("");
  const { send, saving, error, setError } = useSave();

  const cap = categories.find((c) => c.code === category)?.yearly_cap ?? 0;
  const baseValue = Number(base);
  const baseValid = base.trim() !== "" && Number.isInteger(baseValue) && baseValue >= 0 && baseValue <= cap;
  const placementLocked = !!type?.in_use;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (nameUz.trim().length < 2) return setError(r.errors.name_required);
    if (!baseValid) return setError(r.errors.points_out_of_range);
    if (!validReason(reason)) return setError(r.errors.reason_required);
    const body = {
      name: { uz: nameUz.trim(), ...(nameEn.trim() ? { en: nameEn.trim() } : {}), ...(type?.name.ru ? { ru: type.name.ru } : {}) },
      category_code: category,
      base_points: baseValue,
      has_placement: placement,
      proof_hint: hint.trim() || undefined,
      certificate_ref_required: certRequired,
      reason,
    };
    const ok = type
      ? await send(`/api/admin/rubric/types/${type.id}`, "PATCH", body)
      : await send("/api/admin/rubric/types", "POST", body);
    if (ok) onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-4 px-4 pb-6">
      <div className="grid gap-1.5">
        <Label htmlFor="type-name-uz">{r.nameUz}</Label>
        <Input id="type-name-uz" value={nameUz} maxLength={120} onChange={(e) => setNameUz(e.target.value)} className="h-10" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="type-name-en">{r.nameEn}</Label>
        <Input id="type-name-en" value={nameEn} maxLength={120} onChange={(e) => setNameEn(e.target.value)} className="h-10" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="type-category">{r.category}</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger id="type-category" className="w-full data-[size=default]:h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {t.categories[c.code] ?? c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="type-base">{r.basePoints}</Label>
        <Input
          id="type-base"
          type="number"
          inputMode="numeric"
          min={0}
          max={cap}
          step={1}
          value={base}
          aria-invalid={base !== "" && !baseValid}
          aria-describedby="type-base-hint"
          onChange={(e) => setBase(e.target.value)}
          className="h-10 tabular"
        />
        <p id="type-base-hint" className="text-xs text-muted-foreground">
          {format(r.basePointsHint, { cap })}
        </p>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-start gap-2">
          <Checkbox
            id="type-placement"
            checked={placement}
            disabled={placementLocked}
            onCheckedChange={(v) => setPlacement(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor="type-placement" className="leading-snug font-normal">
            {r.hasPlacement}
          </Label>
        </div>
        {placementLocked ? (
          <p className="text-xs text-muted-foreground">{r.hasPlacementLocked}</p>
        ) : type && placement !== type.has_placement ? (
          <p className="text-xs text-status-pending-foreground">{r.hasPlacementWarning}</p>
        ) : null}
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="type-cert"
          checked={certRequired}
          onCheckedChange={(v) => setCertRequired(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor="type-cert" className="leading-snug font-normal">
          {r.certificateRequired}
        </Label>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="type-hint">{r.proofHint}</Label>
        <Textarea id="type-hint" value={hint} maxLength={300} rows={3} onChange={(e) => setHint(e.target.value)} />
      </div>
      <ReasonField id="type-reason" value={reason} onChange={setReason} />
      <SaveError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={saving} className="flex-1 sm:flex-none">
          {saving ? t.admin.saving : r.save}
        </Button>
        <Button type="button" variant="outline" onClick={onDone} className="flex-1 sm:flex-none">
          {r.cancel}
        </Button>
      </div>
    </form>
  );
}

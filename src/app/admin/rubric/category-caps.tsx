"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, t } from "@/i18n";
import type { AdminCategory } from "@/lib/db";
import { CAP_MAX } from "@/lib/validation";

import { ReasonField, SaveError } from "./reason-field";
import { useSave, validReason } from "./use-save";

const r = t.admin.rubric;

function CapCard({ category }: { category: AdminCategory }) {
  const [cap, setCap] = useState(String(category.yearly_cap));
  const [reason, setReason] = useState("");
  const { send, saving, error, setError } = useSave();
  const label = t.categories[category.code] ?? category.name;
  const value = Number(cap);
  const valid = Number.isInteger(value) && value >= 1 && value <= CAP_MAX && cap.trim() !== "";
  const changed = valid && value !== category.yearly_cap;

  async function save() {
    if (!valid) return setError(r.errors.cap_out_of_range);
    if (!validReason(reason)) return setError(r.errors.reason_required);
    if (await send(`/api/admin/rubric/categories/${category.code}`, "PATCH", { yearly_cap: value, reason })) setReason("");
  }

  return (
    <Card className="gap-3 py-4">
      <CardContent className="grid gap-3 px-4">
        <p className="font-medium">{label}</p>
        <div className="grid gap-1.5">
          <Label htmlFor={`cap-${category.code}`}>{r.cap}</Label>
          <Input
            id={`cap-${category.code}`}
            type="number"
            inputMode="numeric"
            min={1}
            max={CAP_MAX}
            step={1}
            value={cap}
            aria-label={format(r.capFor, { category: label })}
            aria-invalid={!valid}
            onChange={(e) => setCap(e.target.value)}
            className="h-10 tabular"
          />
        </div>
        {changed ? <ReasonField id={`cap-reason-${category.code}`} value={reason} onChange={setReason} /> : null}
        <SaveError message={error} />
        <Button onClick={save} disabled={!changed || saving} className="w-full sm:w-fit">
          {saving ? t.admin.saving : r.save}
        </Button>
      </CardContent>
    </Card>
  );
}

export function CategoryCaps({ categories }: { categories: AdminCategory[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {categories.map((c) => (
        // key includes the cap so the form resets after a saved change is re-rendered from the server.
        <CapCard key={`${c.code}-${c.yearly_cap}`} category={c} />
      ))}
    </div>
  );
}

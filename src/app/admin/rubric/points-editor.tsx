"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, t, typeName } from "@/i18n";
import type { AdminCategory, AdminType } from "@/lib/db";
import type { RubricRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LEVELS, type Level, type Result } from "@/lib/validation";

import { ReasonField, SaveError } from "./reason-field";
import { useSave, validReason } from "./use-save";

const r = t.admin.rubric;
const PLACEMENTS: Result[] = ["participant", "finalist", "winner"];
const DEFAULT_LEVEL_MULT: Record<Level, string> = { university: "1", national: "2", international: "4" };
const DEFAULT_RESULT_MULT: Record<string, string> = { participant: "0.5", finalist: "1", winner: "2" };

const key = (level: Level, result: Result) => `${level}:${result}`;
type Values = Record<string, string>; // "" = combination not offered
type Change = { level: Level; result: Result; old: number | null; new: number | null; clamped?: boolean };

const parsePoints = (v: string) => (v.trim() === "" ? null : Number(v));
const validPoints = (v: string, cap: number) => {
  const n = parsePoints(v);
  return n === null || (Number.isInteger(n) && n >= 0 && n <= cap);
};

export function PointsEditor({ types, cells, categories }: { types: AdminType[]; cells: RubricRow[]; categories: AdminCategory[] }) {
  const [typeId, setTypeId] = useState(types[0] ? String(types[0].id) : "");
  const type = types.find((x) => String(x.id) === typeId) ?? types[0];
  if (!type) return <EmptyState text={r.typesEmpty} />;

  const own = cells.filter((c) => c.type_id === type.id);
  const cap = categories.find((c) => c.code === type.category_code)?.yearly_cap ?? 0;
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5 sm:max-w-md">
        <Label htmlFor="points-type">{r.pickType}</Label>
        <Select value={String(type.id)} onValueChange={setTypeId}>
          <SelectTrigger id="points-type" className="w-full data-[size=default]:h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((x) => (
              <SelectItem key={x.id} value={String(x.id)}>
                {typeName(x.name)}
                {x.active ? "" : ` (${r.inactive})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Remount when the saved cells change, so the grid starts from the server's values after a save. */}
      <TypePoints key={`${type.id}|${type.has_placement}|${JSON.stringify(own)}`} type={type} cells={own} cap={cap} />
    </div>
  );
}

function TypePoints({ type, cells, cap }: { type: AdminType; cells: RubricRow[]; cap: number }) {
  const results: Result[] = type.has_placement ? PLACEMENTS : ["confirmed"];
  const initial = useMemo(() => {
    const v: Values = {};
    for (const level of LEVELS)
      for (const result of type.has_placement ? PLACEMENTS : (["confirmed"] as Result[])) v[key(level, result)] = "";
    for (const c of cells) v[key(c.level, c.result)] = String(c.points);
    return v;
  }, [cells, type.has_placement]);
  const [values, setValues] = useState<Values>(initial);
  const [reason, setReason] = useState("");
  const { send, saving, error, setError } = useSave();
  const label = typeName(type.name);

  const changes: Change[] = Object.keys(values)
    .filter((k) => values[k].trim() !== initial[k])
    .map((k) => {
      const [level, result] = k.split(":") as [Level, Result];
      return { level, result, old: parsePoints(initial[k]), new: parsePoints(values[k]) };
    });
  const allValid = Object.values(values).every((v) => validPoints(v, cap));

  async function save(list: Change[], why: string) {
    if (list.length === 0) return setError(r.noChanges);
    if (!validReason(why)) return setError(r.errors.reason_required);
    const ok = await send("/api/admin/rubric/points", "PUT", {
      cells: list.map((c) => ({ type_id: type.id, level: c.level, result: c.result, points: c.new })),
      reason: why,
    });
    if (ok) setReason("");
    return ok;
  }

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-body">{format(r.pointsFor, { type: label })}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 px-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-72 border-separate border-spacing-2 text-small">
            <thead>
              <tr>
                <th scope="col" className="text-left font-medium text-muted-foreground">
                  <span className="sr-only">{t.review.level}</span>
                </th>
                {results.map((res) => (
                  <th key={res} scope="col" className="text-left font-medium text-muted-foreground">
                    {t.results[res]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((level) => (
                <tr key={level}>
                  <th scope="row" className="pr-2 text-left font-medium whitespace-nowrap">
                    {t.levels[level]}
                  </th>
                  {results.map((res) => {
                    const k = key(level, res);
                    const changed = values[k].trim() !== initial[k];
                    const valid = validPoints(values[k], cap);
                    return (
                      <td key={res}>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={cap}
                          step={1}
                          placeholder={r.none}
                          value={values[k]}
                          aria-label={format(r.pointsCell, { type: label, level: t.levels[level], result: t.results[res] })}
                          aria-invalid={!valid}
                          onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                          className={cn("h-10 min-w-16 tabular", changed && "border-primary bg-primary-soft")}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{r.pointsDescription}</p>
        {!allValid ? <SaveError message={format(r.cellInvalid, { cap })} /> : null}

        {changes.length > 0 ? (
          <div className="grid gap-3 rounded-lg border p-3">
            <p className="text-small font-medium">{format(r.changedCells, { n: changes.length })}</p>
            <ReasonField id={`points-reason-${type.id}`} value={reason} onChange={setReason} />
            <SaveError message={error} />
            <div className="flex gap-2">
              <Button onClick={() => save(changes, reason)} disabled={saving || !allValid} className="flex-1 sm:flex-none">
                {saving ? t.admin.saving : r.save}
              </Button>
              <Button variant="outline" onClick={() => setValues(initial)} className="flex-1 sm:flex-none">
                {r.cancel}
              </Button>
            </div>
          </div>
        ) : null}

        <FillHelper
          type={type}
          results={results}
          cap={cap}
          initial={initial}
          onConfirm={save}
          saving={saving}
          saveError={changes.length === 0 ? error : null}
        />
      </CardContent>
    </Card>
  );
}

// Fills cells from base points × level multiplier × result multiplier. Nothing is saved until the admin has seen
// the preview (old → new) and confirms with a reason.
function FillHelper({
  type,
  results,
  cap,
  initial,
  onConfirm,
  saving,
  saveError,
}: {
  type: AdminType;
  results: Result[];
  cap: number;
  initial: Values;
  onConfirm: (changes: Change[], reason: string) => Promise<boolean | void>;
  saving: boolean;
  saveError: string | null; // a server error from saving the preview
}) {
  const offered = LEVELS.filter((l) => results.some((res) => initial[key(l, res)] !== ""));
  const [levels, setLevels] = useState<Level[]>(offered.length ? offered : [...LEVELS]);
  const [levelMult, setLevelMult] = useState(DEFAULT_LEVEL_MULT);
  const [resultMult, setResultMult] = useState(DEFAULT_RESULT_MULT);
  const [preview, setPreview] = useState<Change[] | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const multValid = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100;
  const allValid =
    levels.length > 0 &&
    levels.every((l) => multValid(levelMult[l])) &&
    (!type.has_placement || results.every((res) => multValid(resultMult[res])));

  function compute() {
    setError(null);
    const list: Change[] = [];
    for (const level of levels) {
      for (const res of results) {
        const raw = Math.round(type.base_points * Number(levelMult[level]) * (type.has_placement ? Number(resultMult[res]) : 1));
        const value = Math.min(cap, Math.max(0, raw));
        const old = parsePoints(initial[key(level, res)]);
        if (old !== value) list.push({ level, result: res, old, new: value, clamped: raw > cap });
      }
    }
    setPreview(list);
  }

  async function confirm() {
    if (!preview) return;
    if (!validReason(reason)) return setError(r.errors.reason_required);
    const ok = await onConfirm(preview, reason);
    if (ok) {
      setPreview(null);
      setReason("");
    }
  }

  const multInput = (id: string, labelText: string, value: string, onChange: (v: string) => void) => (
    <div key={id} className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {labelText}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step={0.1}
        value={value}
        aria-invalid={!multValid(value)}
        onChange={(e) => {
          onChange(e.target.value);
          setPreview(null);
        }}
        className="h-10 tabular"
      />
    </div>
  );

  return (
    <details className="group rounded-lg border p-3">
      <summary className="cursor-pointer text-small font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {r.helperTitle}
      </summary>
      <div className="mt-3 grid gap-4">
        <p className="text-xs text-muted-foreground">{r.helperDescription}</p>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-small font-medium">{r.onlyLevels}</legend>
          <div className="flex flex-wrap gap-4">
            {LEVELS.map((level) => (
              <div key={level} className="flex items-center gap-2">
                <Checkbox
                  id={`fill-level-${type.id}-${level}`}
                  checked={levels.includes(level)}
                  onCheckedChange={(v) => {
                    setLevels((ls) => (v === true ? LEVELS.filter((l) => l === level || ls.includes(l)) : ls.filter((l) => l !== level)));
                    setPreview(null);
                  }}
                />
                <Label htmlFor={`fill-level-${type.id}-${level}`} className="font-normal">
                  {t.levels[level]}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LEVELS.filter((l) => levels.includes(l)).map((level) =>
            multInput(`mult-level-${type.id}-${level}`, format(r.levelMultiplier, { level: t.levels[level] }), levelMult[level], (v) =>
              setLevelMult((m) => ({ ...m, [level]: v })),
            ),
          )}
          {type.has_placement
            ? results.map((res) =>
                multInput(`mult-result-${type.id}-${res}`, format(r.resultMultiplier, { result: t.results[res] }), resultMult[res], (v) =>
                  setResultMult((m) => ({ ...m, [res]: v })),
                ),
              )
            : null}
        </div>
        <Button variant="outline" onClick={compute} disabled={!allValid} className="w-full sm:w-fit">
          {r.preview}
        </Button>

        {preview ? (
          preview.length === 0 ? (
            <p className="text-small text-muted-foreground">{r.previewNone}</p>
          ) : (
            <div className="grid gap-3">
              <p className="text-small font-medium">{format(r.previewTitle, { n: preview.length })}</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-3">{r.colCell}</TableHead>
                      <TableHead className="text-right">{r.colOld}</TableHead>
                      <TableHead className="pr-3 text-right">{r.colNew}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((c) => (
                      <TableRow key={key(c.level, c.result)}>
                        <TableCell className="pl-3">
                          {t.levels[c.level]}
                          {c.result !== "confirmed" ? ` · ${t.results[c.result]}` : ""}
                        </TableCell>
                        <TableCell className="text-right tabular">{c.old ?? r.none}</TableCell>
                        <TableCell className="pr-3 text-right font-medium tabular">
                          {c.new}
                          {c.clamped ? <span className="ml-1 text-xs font-normal text-status-pending-foreground">({r.previewClamped})</span> : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ReasonField id={`fill-reason-${type.id}`} value={reason} onChange={setReason} />
              <SaveError message={error ?? saveError} />
              <div className="flex gap-2">
                <Button onClick={confirm} disabled={saving} className="flex-1 sm:flex-none">
                  {saving ? t.admin.saving : r.applyPreview}
                </Button>
                <Button variant="outline" onClick={() => setPreview(null)} className="flex-1 sm:flex-none">
                  {r.cancel}
                </Button>
              </div>
            </div>
          )
        ) : null}
      </div>
    </details>
  );
}

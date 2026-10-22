"use client";

import { Field } from "@/components/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { achievementTypeName, t } from "@/i18n";
import type { AchievementType, RubricRow } from "@/lib/types";
import { LEVELS, RESULTS, type Level, type Result } from "@/lib/validation";

// Type -> level -> result dropdowns. Levels and results are limited to what exists in rubric_points;
// the result dropdown only appears for types with placement. Values are strings ("" = nothing chosen).
export type RubricValue = { typeId: string; level: string; result: string };
export type RubricErrors = Partial<Record<keyof RubricValue, string>>;

export const EMPTY_RUBRIC_VALUE: RubricValue = { typeId: "", level: "", result: "" };

function levelsFor(rubric: RubricRow[], typeId: string): Level[] {
  return LEVELS.filter((l) => rubric.some((r) => String(r.type_id) === typeId && r.level === l));
}

// The selected combination as it would be stored: types without placement are always "confirmed".
export function resolveRubric(
  types: AchievementType[],
  rubric: RubricRow[],
  value: RubricValue,
): { type: AchievementType | undefined; result: Result | ""; row: RubricRow | undefined } {
  const type = types.find((x) => String(x.id) === value.typeId);
  const result: Result | "" = type?.has_placement ? (value.result as Result | "") : type ? "confirmed" : "";
  const row = rubric.find((r) => String(r.type_id) === value.typeId && r.level === value.level && r.result === result);
  return { type, result, row };
}

export function validateRubric(types: AchievementType[], value: RubricValue): RubricErrors {
  const type = types.find((x) => String(x.id) === value.typeId);
  const errors: RubricErrors = {};
  if (!type) errors.typeId = t.errors.required;
  if (!value.level) errors.level = t.errors.required;
  if (type?.has_placement && !value.result) errors.result = t.errors.required;
  return errors;
}

export function RubricSelects({
  types,
  rubric,
  value,
  errors = {},
  disabled,
  onChange,
}: {
  types: AchievementType[];
  rubric: RubricRow[];
  value: RubricValue;
  errors?: RubricErrors;
  disabled?: boolean;
  onChange: (value: RubricValue) => void;
}) {
  const type = types.find((x) => String(x.id) === value.typeId);
  const levels = levelsFor(rubric, value.typeId);
  const results = type?.has_placement
    ? RESULTS.filter((res) =>
        rubric.some((r) => String(r.type_id) === value.typeId && r.level === value.level && r.result === res),
      )
    : [];

  function onTypeChange(typeId: string) {
    const typeLevels = levelsFor(rubric, typeId);
    // Preselect the level when the type has only one (for example software registration: national only).
    onChange({ typeId, level: typeLevels.length === 1 ? typeLevels[0] : "", result: "" });
  }

  return (
    <>
      <Field id="type" label={t.achievement.type} error={errors.typeId}>
        <Select value={value.typeId} disabled={disabled} onValueChange={onTypeChange}>
          <SelectTrigger
            id="type"
            className="w-full text-left whitespace-normal data-[size=default]:h-auto data-[size=default]:min-h-10 *:data-[slot=select-value]:line-clamp-2"
            aria-invalid={!!errors.typeId}
          >
            <SelectValue placeholder={t.achievement.typePlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {types.map((x) => (
              <SelectItem key={x.id} value={String(x.id)}>
                {achievementTypeName(x.id, x.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        id="level"
        label={t.achievement.level}
        error={errors.level}
        hint={type ? undefined : t.achievement.levelNeedsType}
      >
        <Select
          value={value.level}
          disabled={disabled || !type}
          onValueChange={(level) => onChange({ ...value, level, result: "" })}
        >
          <SelectTrigger id="level" className="w-full data-[size=default]:h-10" aria-invalid={!!errors.level}>
            <SelectValue placeholder={t.achievement.levelPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {levels.map((l) => (
              <SelectItem key={l} value={l}>
                {t.levels[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {type?.has_placement ? (
        <Field id="result" label={t.achievement.result} error={errors.result}>
          <Select
            value={value.result}
            disabled={disabled || !value.level}
            onValueChange={(result) => onChange({ ...value, result })}
          >
            <SelectTrigger id="result" className="w-full data-[size=default]:h-10" aria-invalid={!!errors.result}>
              <SelectValue placeholder={t.achievement.resultPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {results.map((r) => (
                <SelectItem key={r} value={r}>
                  {t.results[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
    </>
  );
}

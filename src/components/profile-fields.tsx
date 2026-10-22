"use client";

import { Field } from "@/components/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, t } from "@/i18n";
import type { University } from "@/lib/types";

// Profile part of the sign-up and onboarding forms. Select values are strings ("" = nothing chosen).
export type ProfileValues = {
  fullName: string;
  universityId: string;
  facultyId: string;
  course: string;
  consent: boolean;
};

export type ProfileErrors = Partial<Record<keyof ProfileValues, string>>;

const COURSES = [1, 2, 3, 4, 5, 6];

export function emptyProfileValues(universities: University[]): ProfileValues {
  return {
    fullName: "",
    // Preselect when there is only one university (the pilot).
    universityId: universities.length === 1 ? String(universities[0].id) : "",
    facultyId: "",
    course: "",
    consent: false,
  };
}

export function validateProfileValues(values: ProfileValues): ProfileErrors {
  const errors: ProfileErrors = {};
  if (values.fullName.trim().length < 3) errors.fullName = t.errors.fullNameInvalid;
  if (!values.universityId) errors.universityId = t.errors.required;
  if (!values.facultyId) errors.facultyId = t.errors.required;
  if (!values.course) errors.course = t.errors.required;
  if (!values.consent) errors.consent = t.consent.required;
  return errors;
}

export function ProfileFields({
  universities,
  values,
  errors,
  disabled,
  onChange,
}: {
  universities: University[];
  values: ProfileValues;
  errors: ProfileErrors;
  disabled?: boolean;
  onChange: (values: ProfileValues) => void;
}) {
  const set = <K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) =>
    onChange({ ...values, [key]: value });

  const faculties = universities.find((u) => String(u.id) === values.universityId)?.faculties ?? [];

  return (
    <>
      <Field id="fullName" label={t.form.fullName} error={errors.fullName}>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          className="h-10"
          placeholder={t.form.fullNamePlaceholder}
          value={values.fullName}
          disabled={disabled}
          aria-invalid={!!errors.fullName}
          aria-describedby={errors.fullName ? "fullName-message" : undefined}
          onChange={(e) => set("fullName", e.target.value)}
        />
      </Field>

      <Field id="university" label={t.form.university} error={errors.universityId}>
        <Select
          value={values.universityId}
          disabled={disabled}
          // Changing the university clears the faculty, because faculties belong to one university.
          onValueChange={(v) => onChange({ ...values, universityId: v, facultyId: "" })}
        >
          <SelectTrigger
            id="university"
            className="w-full data-[size=default]:h-10"
            aria-invalid={!!errors.universityId}
          >
            <SelectValue placeholder={t.form.universityPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {universities.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        id="faculty"
        label={t.form.faculty}
        error={errors.facultyId}
        hint={values.universityId ? undefined : t.form.facultyNeedsUniversity}
      >
        <Select
          value={values.facultyId}
          disabled={disabled || !values.universityId}
          onValueChange={(v) => set("facultyId", v)}
        >
          <SelectTrigger id="faculty" className="w-full data-[size=default]:h-10" aria-invalid={!!errors.facultyId}>
            <SelectValue placeholder={t.form.facultyPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {faculties.map((f) => (
              <SelectItem key={f.id} value={String(f.id)}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id="course" label={t.form.course} error={errors.course}>
        <Select value={values.course} disabled={disabled} onValueChange={(v) => set("course", v)}>
          <SelectTrigger id="course" className="w-full data-[size=default]:h-10" aria-invalid={!!errors.course}>
            <SelectValue placeholder={t.form.coursePlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {COURSES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {format(t.form.courseOption, { n })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <section className="grid gap-3 rounded-lg border bg-muted p-3" aria-labelledby="consent-title">
        <h2 id="consent-title" className="text-sm font-semibold">
          {t.consent.title}
        </h2>
        <div className="max-h-40 overflow-y-auto text-sm whitespace-pre-line text-muted-foreground">
          {t.consent.text}
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="consent"
            className="mt-0.5 border-muted-foreground"
            checked={values.consent}
            disabled={disabled}
            aria-invalid={!!errors.consent}
            onCheckedChange={(checked) => set("consent", checked === true)}
          />
          <Label htmlFor="consent" className="leading-snug font-normal">
            {t.consent.checkbox}
          </Label>
        </div>
        {errors.consent ? <p className="text-sm text-destructive">{errors.consent}</p> : null}
      </section>
    </>
  );
}

export function toProfileBody(values: ProfileValues, consentVersion: string) {
  return {
    full_name: values.fullName.trim(),
    university_id: Number(values.universityId),
    faculty_id: Number(values.facultyId),
    course: Number(values.course),
    consent_version: consentVersion,
  };
}

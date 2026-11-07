"use client";

import { Field } from "@/components/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { t } from "@/i18n";
import { EMPLOYER_TERMS_VERSION } from "@/lib/consent";
import { PHONE_RE, TELEGRAM_RE } from "@/lib/validation";

export type AccountType = "student" | "employer";

// The first question at sign-up and onboarding. Only these two roles can be chosen by the person (CLAUDE.md rule 10).
export function AccountTypeChoice({
  value,
  disabled,
  onChange,
}: {
  value: AccountType;
  disabled?: boolean;
  onChange: (value: AccountType) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold">{t.accountType.legend}</legend>
      <RadioGroup
        value={value}
        disabled={disabled}
        onValueChange={(v) => onChange(v === "employer" ? "employer" : "student")}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(["student", "employer"] as const).map((v) => (
          <Label
            key={v}
            htmlFor={`account-${v}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-strong p-3 font-normal has-[[data-state=checked]]:border-primary-text has-[[data-state=checked]]:bg-primary-soft"
          >
            <RadioGroupItem value={v} id={`account-${v}`} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="font-semibold">{t.accountType[v]}</span>
              <span className="text-small text-muted-foreground">{t.accountType[`${v}Hint`]}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

export type EmployerValues = {
  companyName: string;
  contactPerson: string;
  contact: string;
  terms: boolean;
};

export type EmployerErrors = Partial<Record<keyof EmployerValues, string>>;

export const emptyEmployerValues = (): EmployerValues => ({
  companyName: "",
  contactPerson: "",
  contact: "",
  terms: false,
});

// Same rules as employerProfileBodySchema; the server checks again.
export function validateEmployerValues(values: EmployerValues): EmployerErrors {
  const errors: EmployerErrors = {};
  if (values.companyName.trim().length < 2) errors.companyName = t.employerForm.companyInvalid;
  if (values.contactPerson.trim().length < 3) errors.contactPerson = t.employerForm.contactPersonInvalid;
  const contact = values.contact.trim();
  if (!PHONE_RE.test(contact) && !TELEGRAM_RE.test(contact)) errors.contact = t.employerForm.contactInvalid;
  if (!values.terms) errors.terms = t.employerTerms.required;
  return errors;
}

export function toEmployerBody(values: EmployerValues) {
  return {
    role: "employer" as const,
    company_name: values.companyName.trim(),
    contact_person: values.contactPerson.trim(),
    contact: values.contact.trim(),
    terms_version: EMPLOYER_TERMS_VERSION,
  };
}

export function EmployerFields({
  values,
  errors,
  disabled,
  onChange,
}: {
  values: EmployerValues;
  errors: EmployerErrors;
  disabled?: boolean;
  onChange: (values: EmployerValues) => void;
}) {
  const set = <K extends keyof EmployerValues>(key: K, value: EmployerValues[K]) => onChange({ ...values, [key]: value });
  const text = (key: "companyName" | "contactPerson" | "contact", label: string, hint?: string, autoComplete?: string, type = "text") => (
    <Field id={key} label={label} hint={hint} error={errors[key]}>
      <Input
        id={key}
        name={key}
        type={type}
        autoComplete={autoComplete}
        className="h-10"
        value={values[key]}
        disabled={disabled}
        aria-invalid={!!errors[key]}
        aria-describedby={`${key}-message`}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );

  return (
    <>
      {text("companyName", t.employerForm.company, undefined, "organization")}
      {text("contactPerson", t.employerForm.contactPerson, t.employerForm.contactPersonHint, "name")}
      {text("contact", t.employerForm.contact, t.employerForm.contactHint, "tel")}

      <section className="grid gap-3 rounded-lg border bg-muted p-3" aria-labelledby="terms-title">
        <h2 id="terms-title" className="text-sm font-semibold">
          {t.employerTerms.title}
        </h2>
        {t.employerTerms.draft ? (
          <p className="w-fit rounded-md bg-warning px-2 py-1 text-xs font-semibold text-warning-foreground">
            {t.employerTerms.draftLabel}
          </p>
        ) : null}
        <div className="max-h-40 overflow-y-auto text-sm whitespace-pre-line text-muted-foreground">{t.employerTerms.text}</div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="terms"
            className="mt-0.5 border-muted-foreground"
            checked={values.terms}
            disabled={disabled}
            aria-invalid={!!errors.terms}
            onCheckedChange={(checked) => set("terms", checked === true)}
          />
          <Label htmlFor="terms" className="leading-snug font-normal">
            {t.employerTerms.checkbox}
          </Label>
        </div>
        {errors.terms ? <p className="text-sm text-destructive">{errors.terms}</p> : null}
      </section>
    </>
  );
}

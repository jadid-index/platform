"use client";

import { CheckCircle2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Field } from "@/components/field";
import { resolveRubric, RubricSelects, validateRubric, type RubricValue } from "@/components/rubric-selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { format, formatDate, t } from "@/i18n";
import type { Meta } from "@/lib/types";
import {
  JOURNAL_ARTICLE_TYPE_NAME,
  NOTE_MAX_LENGTH,
  PROOF_CONTENT_TYPES,
  PROOF_MAX_BYTES,
  todayInTashkent,
  type Level,
  type Result,
} from "@/lib/validation";

type Values = {
  typeId: string;
  level: string;
  result: string;
  title: string;
  issuer: string;
  date: string;
  certificateRef: string;
  note: string;
};

type Errors = Partial<Record<keyof Values | "file", string>>;

const EMPTY: Values = {
  typeId: "",
  level: "",
  result: "",
  title: "",
  issuer: "",
  date: "",
  certificateRef: "",
  note: "",
};

// Maps API error codes to messages. Unknown codes fall back to the generic error.
const API_ERRORS: Record<string, string> = {
  unauthorized: t.errors.unauthorized,
  no_profile: t.errors.noProfile,
  profile_not_active: t.errors.profileNotActive,
  file_too_large: t.errors.fileTooLarge,
  file_type: t.errors.fileType,
  file_missing: t.errors.fileMissing,
  duplicate_file: t.errors.duplicateFile,
  invalid_type: t.errors.invalidCombination,
  invalid_combination: t.errors.invalidCombination,
  date_in_future: t.errors.dateInFuture,
  certificate_ref_required: t.errors.certificateRefRequired,
  invalid_body: t.errors.invalidBody,
  invalid_ticket: t.errors.uploadExpired,
  upload_expired: t.errors.uploadExpired,
  too_many_pending: t.errors.tooManyPending,
  rate_limited: t.errors.rateLimited,
};

type Phase = "idle" | "uploading" | "submitting" | "done";

export function AchievementForm({ meta }: { meta: Meta }) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [formKey, setFormKey] = useState(0);

  const busy = phase === "uploading" || phase === "submitting";
  const rubricValue: RubricValue = { typeId: values.typeId, level: values.level, result: values.result };
  const { type, row: preview } = resolveRubric(meta.achievement_types, meta.rubric_points, rubricValue);
  const certificateRequired = type?.name === JOURNAL_ARTICLE_TYPE_NAME;
  // Field labels follow the chosen type (for example "Jurnal nomi" instead of "Tashkilot" for an article).
  const labels = {
    title: t.achievement.titleLabel,
    titlePlaceholder: t.achievement.titlePlaceholder,
    issuer: t.achievement.issuer,
    issuerPlaceholder: t.achievement.issuerPlaceholder,
    date: t.achievement.date,
    certificateRef: t.achievement.certificateRef,
    file: t.achievement.file,
    fileHint: t.achievement.fileHint,
    ...(type ? t.achievementFields[type.id] : undefined),
  };
  const today = todayInTashkent();

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  function validate(): Errors {
    const e: Errors = validateRubric(meta.achievement_types, rubricValue);
    if (values.title.trim().length < 3) e.title = t.errors.titleInvalid;
    if (values.issuer.trim().length < 2) e.issuer = t.errors.issuerInvalid;
    if (!values.date) e.date = t.errors.dateInvalid;
    else if (values.date > today) e.date = t.errors.dateInFuture;
    else if (values.date < meta.count_from) e.date = format(t.errors.dateTooEarly, { date: formatDate(meta.count_from) });
    if (certificateRequired && !values.certificateRef.trim()) e.certificateRef = t.errors.certificateRefRequired;
    if (values.note.length > NOTE_MAX_LENGTH) e.note = t.errors.noteTooLong;
    if (!file) e.file = t.errors.fileRequired;
    else if (!(PROOF_CONTENT_TYPES as readonly string[]).includes(file.type)) e.file = t.errors.fileType;
    else if (file.size > PROOF_MAX_BYTES) e.file = t.errors.fileTooLarge;
    return e;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !file || !type) return;

    const fail = async (res: Response) => {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      if (error === "date_too_early") {
        setErrors({ date: format(t.errors.dateTooEarly, { date: formatDate(meta.count_from) }) });
      } else {
        setFormError((error && API_ERRORS[error]) || t.common.genericError);
      }
      setPhase("idle");
    };

    try {
      // 1. Reserve a submission id and get a one-time upload URL.
      setPhase("uploading");
      const urlRes = await fetch("/api/submissions/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: file.name, size: file.size, content_type: file.type }),
      });
      if (!urlRes.ok) return fail(urlRes);
      const upload = (await urlRes.json()) as {
        submission_id: string;
        file_name: string;
        upload_url: string;
        upload_ticket: string;
      };

      // 2. Upload the file straight to the private bucket.
      const put = await fetch(upload.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          "x-upsert": "false",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        },
        body: file,
      });
      if (!put.ok) {
        setFormError(t.errors.uploadFailed);
        setPhase("idle");
        return;
      }

      // 3. Create the submission. The server checks and hashes the stored file.
      setPhase("submitting");
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: upload.submission_id,
          file_name: upload.file_name,
          upload_ticket: upload.upload_ticket,
          type_id: type.id,
          level: values.level as Level,
          result: type.has_placement ? (values.result as Result) : undefined,
          title: values.title,
          issuer: values.issuer,
          achievement_date: values.date,
          certificate_ref: values.certificateRef || undefined,
          note: values.note || undefined,
        }),
      });
      if (!res.ok) return fail(res);
      setPhase("done");
    } catch {
      setFormError(t.common.genericError);
      setPhase("idle");
    }
  }

  function reset() {
    setValues(EMPTY);
    setFile(null);
    setErrors({});
    setFormError(null);
    setPhase("idle");
    setFormKey((k) => k + 1);
  }

  // With Cache Components this page stays mounted after the student navigates away. Effects clean up when
  // it is hidden, so start with an empty form next time instead of the old success screen.
  useEffect(() => {
    if (phase !== "done") return;
    return () => reset();
  }, [phase]);

  if (phase === "done") {
    return (
      <div className="grid gap-4">
        <Alert className="border-primary bg-primary-soft">
          <CheckCircle2 aria-hidden />
          <AlertTitle>{t.achievement.successTitle}</AlertTitle>
          <AlertDescription className="text-foreground">{t.achievement.successBody}</AlertDescription>
        </Alert>
        <Button asChild size="lg">
          <Link href="/dashboard">{t.achievement.toDashboard}</Link>
        </Button>
        <Button variant="outline" size="lg" onClick={reset}>
          {t.achievement.addAnother}
        </Button>
      </div>
    );
  }

  return (
    <form key={formKey} className="grid gap-5" noValidate onSubmit={onSubmit}>
      <RubricSelects
        types={meta.achievement_types}
        rubric={meta.rubric_points}
        value={rubricValue}
        errors={errors}
        disabled={busy}
        onChange={(r) => setValues((v) => ({ ...v, ...r }))}
      />

      {preview ? (
        <div className="flex items-start gap-3 rounded-lg border border-primary bg-primary-soft p-3 text-sm" aria-live="polite">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary-strong" aria-hidden />
          <div className="grid gap-1">
            <span className="text-xs font-semibold tracking-wide text-primary-strong uppercase">
              {t.achievement.previewLabel}
            </span>
            <span className="font-medium">{format(t.achievement.previewPoints, { points: preview.points })}</span>
            <span className="text-muted-foreground">{t.achievement.previewNote}</span>
          </div>
        </div>
      ) : null}

      <Field id="title" label={labels.title} error={errors.title}>
        <Input
          id="title"
          className="h-10"
          maxLength={300}
          placeholder={labels.titlePlaceholder}
          value={values.title}
          disabled={busy}
          aria-invalid={!!errors.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>

      <Field id="issuer" label={labels.issuer} error={errors.issuer}>
        <Input
          id="issuer"
          className="h-10"
          maxLength={300}
          placeholder={labels.issuerPlaceholder}
          value={values.issuer}
          disabled={busy}
          aria-invalid={!!errors.issuer}
          onChange={(e) => set("issuer", e.target.value)}
        />
      </Field>

      <Field
        id="date"
        label={labels.date}
        error={errors.date}
        hint={format(t.achievement.dateHint, { date: formatDate(meta.count_from) })}
      >
        <Input
          id="date"
          type="date"
          className="h-10"
          min={meta.count_from}
          max={today}
          value={values.date}
          disabled={busy}
          aria-invalid={!!errors.date}
          onChange={(e) => set("date", e.target.value)}
        />
      </Field>

      <Field
        id="certificateRef"
        label={labels.certificateRef}
        error={errors.certificateRef}
        hint={certificateRequired ? t.achievement.certificateRefRequired : t.achievement.certificateRefHint}
      >
        <Input
          id="certificateRef"
          className="h-10"
          maxLength={500}
          value={values.certificateRef}
          disabled={busy}
          aria-invalid={!!errors.certificateRef}
          onChange={(e) => set("certificateRef", e.target.value)}
        />
      </Field>

      <Field
        id="note"
        label={t.achievement.note}
        error={errors.note}
        hint={format(t.achievement.noteCounter, { count: values.note.length, max: NOTE_MAX_LENGTH })}
      >
        <Textarea
          id="note"
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          value={values.note}
          disabled={busy}
          aria-invalid={!!errors.note}
          onChange={(e) => set("note", e.target.value)}
        />
      </Field>

      <Field id="file" label={labels.file} error={errors.file} hint={labels.fileHint}>
        <Input
          id="file"
          type="file"
          className="h-10"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          disabled={busy}
          aria-invalid={!!errors.file}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {phase === "uploading"
          ? t.achievement.uploading
          : phase === "submitting"
            ? t.achievement.submitting
            : t.achievement.submit}
      </Button>
    </form>
  );
}

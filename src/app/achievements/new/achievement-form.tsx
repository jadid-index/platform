"use client";

import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Field } from "@/components/field";
import { resolveRubric, RubricSelects, validateRubric, type RubricValue } from "@/components/rubric-selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { format, formatDate, t } from "@/i18n";
import { kindFitsType } from "@/lib/document-kinds";
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

// The proof is uploaded as soon as it is picked (upload-url, then a direct PUT to the private bucket), so it can
// be read by /api/extract while the student fills in the form. POST /api/submissions reuses it.
type Upload = { submission_id: string; file_name: string; path: string; upload_ticket: string };
type ReadState = "none" | "uploading" | "reading" | "filled" | "empty" | "low" | "failed" | "busy" | "off" | "upload_failed";
type Extraction = {
  document_kind: string;
  title: string | null;
  issuer: string | null;
  achievement_date: string | null;
  certificate_ref: string | null;
  level_hint: "university" | "national" | "international" | "unknown";
  level_evidence: string | null;
  result_hint: "participant" | "finalist" | "winner" | "unknown";
  result_evidence: string | null;
  confidence: "low" | "medium" | "high";
};

async function uploadProof(file: File): Promise<Upload | { error: string }> {
  const urlRes = await fetch("/api/submissions/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_name: file.name, size: file.size, content_type: file.type }),
  });
  if (!urlRes.ok) {
    const { error } = (await urlRes.json().catch(() => ({}))) as { error?: string };
    return { error: error ?? "upload_failed" };
  }
  const upload = (await urlRes.json()) as Upload & { upload_url: string };
  const put = await fetch(upload.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      "x-upsert": "false",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    },
    body: file,
  });
  if (!put.ok) return { error: "upload_failed" };
  return { submission_id: upload.submission_id, file_name: upload.file_name, path: upload.path, upload_ticket: upload.upload_ticket };
}

export function AchievementForm({ meta }: { meta: Meta }) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [formKey, setFormKey] = useState(0);
  const [readState, setReadState] = useState<ReadState>("none");
  const [extraction, setExtraction] = useState<{ result: Extraction; token: string; submission_id: string } | null>(null);
  // The current upload, or the upload in progress. Bumped on every pick, so a late result for an earlier file is ignored.
  const uploadRef = useRef<{ seq: number; promise: Promise<Upload | null> } | null>(null);
  const seqRef = useRef(0);
  // Latest values, for code that runs after an await (pre-fill must not overwrite what the student typed since).
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

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

  function fileError(f: File | null): string | undefined {
    if (!f) return t.errors.fileRequired;
    if (!(PROOF_CONTENT_TYPES as readonly string[]).includes(f.type)) return t.errors.fileType;
    if (f.size > PROOF_MAX_BYTES) return t.errors.fileTooLarge;
    return undefined;
  }

  // Upload now, then let the AI read it. Either step may fail; the form always stays usable by hand.
  function startUpload(f: File, seq: number): Promise<Upload | null> {
    const promise = uploadProof(f).then((r) => ("error" in r ? null : r)).catch(() => null);
    uploadRef.current = { seq, promise };
    return promise;
  }

  async function onFilePicked(f: File | null) {
    setFile(f);
    setExtraction(null);
    const seq = ++seqRef.current;
    uploadRef.current = null;
    const error = f ? fileError(f) : undefined;
    setErrors((e) => ({ ...e, file: error }));
    if (!f || error) {
      setReadState("none");
      return;
    }

    setReadState("uploading");
    const upload = await startUpload(f, seq);
    if (seq !== seqRef.current) return;
    if (!upload) {
      setReadState("upload_failed");
      return;
    }

    setReadState("reading");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_id: upload.submission_id, path: upload.path }),
      });
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string };
        setReadState(code === "extraction_disabled" ? "off" : code === "rate_limited" || code === "extraction_busy" ? "busy" : "failed");
        return;
      }
      const data = (await res.json()) as { result: Extraction; extraction_token: string };
      if (seq !== seqRef.current) return;
      setExtraction({ result: data.result, token: data.extraction_token, submission_id: upload.submission_id });
      if (data.result.confidence === "low") {
        setReadState("low");
        return;
      }
      // Pre-fill only the fields the student has not typed yet; nothing is set silently over their input.
      const r = data.result;
      const isDate = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
      const current = valuesRef.current;
      const fills: Partial<Values> = {};
      const fill = (key: "title" | "issuer" | "date" | "certificateRef", value: string | null) => {
        if (value && !current[key].trim()) fills[key] = value.slice(0, key === "certificateRef" ? 500 : 300);
      };
      fill("title", r.title);
      fill("issuer", r.issuer);
      fill("date", isDate(r.achievement_date) ? r.achievement_date : null);
      fill("certificateRef", r.certificate_ref);
      const filledAny = Object.keys(fills).length > 0;
      // Apply only where the field is still empty at the moment of the update, too.
      setValues((v) => {
        const next = { ...v };
        for (const [key, value] of Object.entries(fills) as [keyof Values, string][]) if (!v[key].trim()) next[key] = value;
        return next;
      });
      setReadState(filledAny || r.level_hint !== "unknown" || r.result_hint !== "unknown" ? "filled" : "empty");
    } catch {
      if (seq === seqRef.current) setReadState("failed");
    }
  }

  function validate(): Errors {
    const e: Errors = validateRubric(meta.achievement_types, rubricValue);
    if (values.title.trim().length < 3) e.title = t.errors.titleInvalid;
    if (values.issuer.trim().length < 2) e.issuer = t.errors.issuerInvalid;
    if (!values.date) e.date = t.errors.dateInvalid;
    else if (values.date > today) e.date = t.errors.dateInFuture;
    else if (values.date < meta.count_from) e.date = format(t.errors.dateTooEarly, { date: formatDate(meta.count_from) });
    if (certificateRequired && !values.certificateRef.trim()) e.certificateRef = t.errors.certificateRefRequired;
    if (values.note.length > NOTE_MAX_LENGTH) e.note = t.errors.noteTooLong;
    const fe = fileError(file);
    if (fe) e.file = fe;
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

    const submit = (upload: Upload) =>
      fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submission_id: upload.submission_id,
          file_name: upload.file_name,
          upload_ticket: upload.upload_ticket,
          // The signed extraction result is stored for the reviewer; only for this upload.
          extraction_token: extraction?.submission_id === upload.submission_id ? extraction.token : undefined,
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

    try {
      // Reuse the file uploaded when it was picked; upload it now if that failed or never happened.
      setPhase("uploading");
      let upload = (await uploadRef.current?.promise) ?? null;
      if (!upload) upload = await startUpload(file, seqRef.current);
      if (!upload) {
        setFormError(t.errors.uploadFailed);
        setPhase("idle");
        return;
      }

      // The server checks and hashes the stored file again.
      setPhase("submitting");
      let res = await submit(upload);
      if (!res.ok && res.status === 400) {
        const { error } = (await res.clone().json().catch(() => ({}))) as { error?: string };
        // The upload window passed while the form was open: upload the same file again, visibly, and resubmit once.
        if (error === "upload_expired" || error === "invalid_ticket") {
          setPhase("uploading");
          upload = await startUpload(file, seqRef.current);
          if (!upload) {
            setFormError(t.errors.uploadFailed);
            setPhase("idle");
            return;
          }
          setPhase("submitting");
          res = await submit(upload);
        }
      }
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
    setExtraction(null);
    setReadState("none");
    uploadRef.current = null;
    seqRef.current++;
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
      <Field id="file" label={labels.file} error={errors.file} hint={labels.fileHint}>
        <Input
          id="file"
          type="file"
          className="h-10"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          disabled={busy}
          aria-invalid={!!errors.file}
          onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
        />
      </Field>

      <ReadStatus state={readState} />
      <RubricSelects
        types={meta.achievement_types}
        rubric={meta.rubric_points}
        value={rubricValue}
        errors={errors}
        disabled={busy}
        onChange={(r) => setValues((v) => ({ ...v, ...r }))}
      />

      {extraction && type && readState === "filled" ? (
        <Suggestions
          extraction={extraction.result}
          hasPlacement={type.has_placement}
          isValid={(level, result) =>
            meta.rubric_points.some(
              (r) => r.type_id === type.id && r.level === level && (!type.has_placement || !result || r.result === result),
            )
          }
          level={values.level}
          result={values.result}
          disabled={busy}
          onAccept={(r) => setValues((v) => ({ ...v, ...r }))}
        />
      ) : null}

      {extraction && type && !kindFitsType(extraction.result.document_kind, type.id) ? (
        <Alert>
          <AlertTriangle aria-hidden />
          <AlertDescription>
            {format(t.extract.kindMismatch, {
              kind: t.review.documentKinds[extraction.result.document_kind] ?? extraction.result.document_kind,
            })}
          </AlertDescription>
        </Alert>
      ) : null}

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

// One line under the file field. The form works the same whatever this says.
function ReadStatus({ state }: { state: ReadState }) {
  const text: Partial<Record<ReadState, string>> = {
    uploading: t.extract.uploading,
    reading: t.extract.reading,
    filled: t.extract.filled,
    empty: t.extract.nothingFound,
    low: t.extract.low,
    failed: t.extract.failed,
    busy: t.extract.busy,
    upload_failed: t.extract.uploadFailed,
  };
  const message = text[state];
  if (!message) return null;
  const working = state === "uploading" || state === "reading";
  const Icon = working ? Loader2 : state === "filled" ? Wand2 : AlertTriangle;
  return (
    <p
      className="-mt-2 flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${working ? "animate-spin" : ""}`} aria-hidden />
      {message}
    </p>
  );
}

// level_hint / result_hint as one-tap suggestions with the words the AI found. Never applied silently.
function Suggestions({
  extraction: x,
  hasPlacement,
  isValid,
  level,
  result,
  disabled,
  onAccept,
}: {
  extraction: Extraction;
  hasPlacement: boolean;
  isValid: (level: string, result: string) => boolean;
  level: string;
  result: string;
  disabled: boolean;
  onAccept: (value: { level?: string; result?: string }) => void;
}) {
  const items: { key: string; label: string; evidence: string | null; apply: { level?: string; result?: string } }[] = [];
  if (x.level_hint !== "unknown" && x.level_hint !== level && isValid(x.level_hint, result)) {
    items.push({ key: "level", label: `${t.achievement.level}: ${t.levels[x.level_hint]}`, evidence: x.level_evidence, apply: { level: x.level_hint } });
  }
  if (hasPlacement && x.result_hint !== "unknown" && x.result_hint !== result && isValid(level || x.level_hint, x.result_hint)) {
    items.push({ key: "result", label: `${t.achievement.result}: ${t.results[x.result_hint]}`, evidence: x.result_evidence, apply: { result: x.result_hint } });
  }
  if (items.length === 0) return null;
  return (
    <div className="grid gap-2 rounded-lg border border-primary bg-primary-soft p-3 text-sm">
      <span className="text-xs font-semibold tracking-wide text-primary-strong uppercase">{t.extract.suggestion}</span>
      {items.map((item) => (
        <div key={item.key} className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-0.5">
            <span className="font-medium">{item.label}</span>
            {item.evidence ? (
              <span className="text-muted-foreground">{format(t.extract.evidence, { text: item.evidence })}</span>
            ) : null}
          </div>
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onAccept(item.apply)}>
            {t.extract.accept}
          </Button>
        </div>
      ))}
    </div>
  );
}

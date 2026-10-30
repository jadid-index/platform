"use client";

import { Check, CheckCircle2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Field } from "@/components/field";
import { resolveRubric, RubricSelects, validateRubric, type RubricValue } from "@/components/rubric-selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ds";
import { Textarea } from "@/components/ui/textarea";
import { academicYearLabel, format, formatDate, t } from "@/i18n";
import type { AchievementType, PointsPreview, RubricRow } from "@/lib/types";
import { REJECTION_REASON_MAX_LENGTH } from "@/lib/validation";

type PreviewState = { status: "ok"; data: PointsPreview } | { status: "loading" | "error" | "incomplete" };

// Readable text for the codes returned by /api/review/submissions/:id/{approve,reject}.
function errorText(body: { error?: string; date?: string }): string {
  switch (body.error) {
    case "not_found":
      return t.errors.reviewNotFound;
    case "not_pending":
      return t.errors.reviewNotPending;
    case "forbidden":
    case "unauthorized":
      return t.errors.reviewForbidden;
    case "self_review":
      return t.errors.selfReview;
    case "invalid_combination":
      return t.errors.invalidCombination;
    case "date_too_early":
      return format(t.errors.reviewDateTooEarly, { date: body.date ? formatDate(body.date) : "" });
    case "reason_required":
      return t.errors.reasonRequired;
    case "invalid_body":
      return t.errors.invalidBody;
    default:
      return t.common.genericError;
  }
}

export function ReviewPanel({
  submissionId,
  types,
  rubric,
  initial,
  initialPreview,
  disabled,
}: {
  submissionId: string;
  types: AchievementType[];
  rubric: RubricRow[];
  initial: RubricValue;
  initialPreview: PointsPreview | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<RubricValue>(initial);
  // Last preview fetched from the server, with the combination it belongs to.
  const [fetched, setFetched] = useState<{ key: string; state: PreviewState } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set after a successful approval, from the reviews row returned by approve_submission().
  const [approved, setApproved] = useState<{ rubric_points: number; points_awarded: number } | null>(null);

  const { type, result, row } = resolveRubric(types, rubric, value);
  const previewKey = row ? `${row.type_id}|${row.level}|${row.result}` : "";
  const initialKey = `${initial.typeId}|${initial.level}|${initial.result}`;

  // Fetch the server-side points preview whenever the reviewer changes the combination.
  // The submitted combination uses the preview rendered with the page.
  const needsFetch = previewKey !== "" && !(previewKey === initialKey && initialPreview);
  useEffect(() => {
    if (!needsFetch) return;
    const [typeId, level, res] = previewKey.split("|");
    const controller = new AbortController();
    const query = new URLSearchParams({ type_id: typeId, level, result: res });
    fetch(`/api/review/submissions/${submissionId}/preview?${query}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setFetched({ key: previewKey, state: { status: "ok", data: (await r.json()) as PointsPreview } });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        console.error(e);
        setFetched({ key: previewKey, state: { status: "error" } });
      });
    return () => controller.abort();
  }, [needsFetch, previewKey, submissionId]);

  let preview: PreviewState;
  if (!previewKey) preview = { status: "incomplete" };
  else if (!needsFetch) preview = initialPreview ? { status: "ok", data: initialPreview } : { status: "error" };
  else preview = fetched?.key === previewKey ? fetched.state : { status: "loading" };

  async function send(action: "approve" | "reject") {
    setError(null);
    if (action === "approve" && Object.keys(validateRubric(types, value)).length > 0) {
      setError(t.errors.invalidCombination);
      return;
    }
    if (action === "reject" && !reason.trim()) {
      setError(t.errors.reasonRequired);
      return;
    }

    setPending(action);
    try {
      const body =
        action === "approve"
          ? { type_id: Number(value.typeId), level: value.level, result: result || undefined }
          : { reason: reason.trim() };
      const res = await fetch(`/api/review/submissions/${submissionId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(errorText(await res.json().catch(() => ({}))));
        return;
      }
      if (action === "approve") {
        setApproved((await res.json()) as { rubric_points: number; points_awarded: number });
        return;
      }
      router.push("/review");
      router.refresh();
    } catch {
      setError(t.common.genericError);
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null || disabled;

  if (approved) {
    return (
      <Card className="gap-3 py-4">
        <CardContent className="grid gap-4 px-4">
          <Alert className="border-primary bg-primary-soft" aria-live="polite">
            <CheckCircle2 aria-hidden />
            <AlertTitle>{t.review.approvedTitle}</AlertTitle>
            <AlertDescription className="text-foreground">
              {approved.points_awarded < approved.rubric_points
                ? format(t.review.approvedCapped, { rubric: approved.rubric_points, points: approved.points_awarded })
                : format(t.review.approvedPoints, { points: approved.points_awarded })}
            </AlertDescription>
          </Alert>
          <Button
            size="lg"
            onClick={() => {
              router.push("/review");
              router.refresh();
            }}
          >
            {t.review.backToQueueButton}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle>{t.review.decision}</CardTitle>
          <CardDescription>{t.review.decisionHint}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-4">
          <RubricSelects types={types} rubric={rubric} value={value} disabled={busy} onChange={setValue} />

          {type?.proof_hint ? (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="font-semibold">{t.review.proofHint}</p>
              <p className="text-muted-foreground">{type.proof_hint}</p>
            </div>
          ) : null}

          <PreviewBox state={preview} />

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {rejecting ? (
            <div className="grid gap-3 rounded-md border border-status-rejected-foreground/30 bg-status-rejected/40 p-3">
              <Field id="reason" label={t.review.rejectReason} hint={t.review.rejectReasonHint}>
                <Textarea
                  id="reason"
                  rows={4}
                  maxLength={REJECTION_REASON_MAX_LENGTH}
                  value={reason}
                  disabled={busy}
                  className="bg-card"
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" size="lg" disabled={busy || !reason.trim()} onClick={() => send("reject")}>
                  <X aria-hidden />
                  {pending === "reject" ? t.review.rejecting : t.review.rejectConfirm}
                </Button>
                <Button variant="outline" size="lg" disabled={pending !== null} onClick={() => setRejecting(false)}>
                  {t.review.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button size="lg" disabled={busy || !row} onClick={() => send("approve")}>
                <Check aria-hidden />
                {pending === "approve" ? t.review.approving : t.review.approve}
              </Button>
              <Button variant="outline" size="lg" disabled={busy} onClick={() => setRejecting(true)}>
                <X aria-hidden />
                {t.review.reject}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

function PreviewBox({ state }: { state: PreviewState }) {
  return (
    <div className="grid gap-2 rounded-md border border-primary bg-primary-soft p-3 text-sm" aria-live="polite">
      <p className="text-xs font-semibold tracking-wide text-primary-strong uppercase">{t.review.preview}</p>
      {state.status === "loading" ? <p className="text-muted-foreground">{t.common.loading}</p> : null}
      {state.status === "error" ? <p className="text-destructive">{t.review.previewError}</p> : null}
      {state.status === "incomplete" ? <p className="text-muted-foreground">{t.review.previewInvalid}</p> : null}
      {state.status === "ok" ? <PreviewRows data={state.data} /> : null}
    </div>
  );
}

function PreviewRows({ data }: { data: PointsPreview }) {
  if (data.rubric_points === null) return <p className="text-muted-foreground">{t.review.previewInvalid}</p>;
  const category = t.categories[data.category_code] ?? data.category_code;
  return (
    <>
      <dl className="grid gap-1">
        <div className="flex justify-between gap-3">
          <dt>{t.review.previewRubric}</dt>
          <dd className="font-medium tabular">{data.rubric_points}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>
            {format(t.review.previewUsed, { year: academicYearLabel(data.academic_year) })} ({category})
          </dt>
          <dd className="font-medium whitespace-nowrap tabular">
            {data.used} / {data.cap}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-primary pt-1 text-base">
          <dt className="font-semibold">{t.review.previewAwarded}</dt>
          <dd className="font-semibold text-primary-strong tabular">{data.awarded}</dd>
        </div>
      </dl>
      {data.awarded < data.rubric_points ? <p className="text-muted-foreground">{t.review.previewCapped}</p> : null}
    </>
  );
}

"use client";

import { FileDown, FileText, Info, Loader2, Upload } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { format, formatDate, t } from "@/i18n";
import type { CvVisibility, OwnCvFile } from "@/lib/types";
import { CV_FILE_MAX_BYTES } from "@/lib/validation";

// The student's uploaded CV (a PDF made elsewhere). Three steps, like proofs: ask for a one-time upload URL, upload
// straight to storage, then let the server screen and finalize it. The screen is simple and is not a malware scan;
// the help text says so. While the CV is public, a checkbox confirms the file may be seen by anyone.
type State = "idle" | "uploading" | "checking" | "deleting";

export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? format(t.cv.file.sizeMb, { n: (bytes / (1024 * 1024)).toFixed(1) })
    : format(t.cv.file.sizeKb, { n: Math.max(1, Math.round(bytes / 1024)) });
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "";
}

export function CvFileCard({
  studentId,
  initial,
  visibility,
  onChange,
}: {
  studentId: string;
  initial: OwnCvFile | null;
  visibility: CvVisibility;
  onChange: (file: OwnCvFile | null) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<OwnCvFile | null>(initial);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [publicOk, setPublicOk] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const busy = state !== "idle";
  const isPublic = visibility === "public";
  const blocked = isPublic && !publicOk;

  function update(next: OwnCvFile | null) {
    setFile(next);
    onChange(next);
  }

  function fail(code: string, fallback: string) {
    setError(t.cv.file.errors[code] ?? fallback);
    setState("idle");
  }

  async function upload(picked: File) {
    setError(null);
    setNotice(null);
    // Quick checks in the browser; the server checks the real bytes again.
    if (!picked.name.toLowerCase().endsWith(".pdf") || (picked.type && picked.type !== "application/pdf")) {
      return fail("file_type", t.cv.file.uploadError);
    }
    if (picked.size > CV_FILE_MAX_BYTES) return fail("file_too_large", t.cv.file.uploadError);
    if (blocked) return fail("file_confirmation_required", t.cv.file.uploadError);
    const confirm = isPublic ? { confirm_public: true } : {};

    setState("uploading");
    try {
      const urlRes = await fetch("/api/me/cv/file/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: picked.name, size: picked.size, content_type: "application/pdf", ...confirm }),
      });
      if (!urlRes.ok) return fail(await errorCode(urlRes), t.cv.file.uploadError);
      const { upload_id, upload_url } = (await urlRes.json()) as { upload_id: string; upload_url: string };

      const put = await fetch(upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          "x-upsert": "false",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        },
        body: picked,
      });
      if (!put.ok) return fail("", t.cv.file.uploadError);

      setState("checking");
      const done = await fetch("/api/me/cv/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id, ...confirm }),
      });
      if (!done.ok) return fail(await errorCode(done), t.cv.file.uploadError);
      update((await done.json()) as OwnCvFile);
      setNotice(t.cv.file.uploaded);
      setState("idle");
    } catch {
      fail("", t.cv.file.uploadError);
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setNotice(null);
    setState("deleting");
    try {
      const res = await fetch("/api/me/cv/file", { method: "DELETE" });
      if (!res.ok && res.status !== 404) return fail(await errorCode(res), t.cv.file.deleteError);
      update(null);
      setDeleteOpen(false);
      setNotice(t.cv.file.deleted);
      setState("idle");
    } catch {
      fail("", t.cv.file.deleteError);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const picked = e.dataTransfer.files?.[0];
    if (picked && !busy) void upload(picked);
  }

  const status =
    state === "uploading" ? t.cv.file.uploading : state === "checking" ? t.cv.file.checking : state === "deleting" ? t.cv.file.deleting : null;

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle id={`${id}-title`} className="text-h2">
          {t.cv.file.title}
        </CardTitle>
        <CardDescription>{t.cv.file.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-5">
        {file ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface p-3">
            <FileText className="size-6 shrink-0 text-muted-foreground" aria-hidden />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="truncate font-medium" title={file.file_name}>
                {file.file_name}
              </p>
              <p className="text-small text-muted-foreground">
                {format(t.cv.file.meta, { size: fileSize(file.size), date: formatDate(file.uploaded_at) })}
              </p>
              <Badge variant="outline" className="w-fit">
                <Info className="size-3" aria-hidden />
                {t.cv.file.label}
              </Badge>
            </div>
            <a
              href={`/api/cv/${studentId}/file`}
              className="inline-flex items-center gap-1.5 text-small font-medium text-primary-text underline-offset-4 hover:underline"
            >
              <FileDown className="size-4" aria-hidden />
              {t.cv.file.download}
            </a>
          </div>
        ) : (
          <p className="text-small text-muted-foreground">{t.cv.file.empty}</p>
        )}

        {isPublic ? (
          <div className="flex items-start gap-3 rounded-lg border bg-surface-sunken p-3">
            <Checkbox
              id={`${id}-public`}
              className="mt-0.5"
              checked={publicOk}
              onCheckedChange={(c) => setPublicOk(c === true)}
              disabled={busy}
            />
            <Label htmlFor={`${id}-public`} className="leading-snug font-normal">
              {t.cv.file.publicConfirm}
            </Label>
          </div>
        ) : null}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy && !blocked) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-dragging={dragging || undefined}
          className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border-strong p-5 text-center data-dragging:border-primary-text data-dragging:bg-surface-sunken"
        >
          <Upload className="size-6 text-muted-foreground" aria-hidden />
          <p className="hidden text-small text-muted-foreground lg:block">
            {t.cv.file.drop} {t.cv.file.or}
          </p>
          <input
            ref={input}
            id={`${id}-input`}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={busy || blocked}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) void upload(picked);
            }}
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={() => input.current?.click()} disabled={busy || blocked}>
              {busy && state !== "deleting" ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              {file ? t.cv.file.replace : t.cv.file.choose}
            </Button>
            {file ? (
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)} disabled={busy}>
                {t.cv.file.delete}
              </Button>
            ) : null}
          </div>
        </div>

        <ul className="grid gap-1 text-small text-muted-foreground">
          {t.cv.file.help.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <p className="text-small" role="status" aria-live="polite">
          {status ? <span className="text-muted-foreground">{status}</span> : null}
          {!status && notice ? <span className="text-primary-text">{notice}</span> : null}
          {!status && error && !deleteOpen ? <span className="text-destructive">{error}</span> : null}
        </p>
      </CardContent>

      <Dialog open={deleteOpen} onOpenChange={(open) => !busy && setDeleteOpen(open)}>
        <DialogContent className="sm:max-w-md" closeLabel={t.cv.file.cancel}>
          <DialogHeader>
            <DialogTitle>{t.cv.file.deleteTitle}</DialogTitle>
            <DialogDescription>{t.cv.file.deleteText}</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-small text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>
              {t.cv.file.cancel}
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              {state === "deleting" ? t.cv.file.deleting : t.cv.file.deleteConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

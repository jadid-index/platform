import { FileDown } from "lucide-react";

import { t } from "@/i18n";

// "Download CV (PDF)" for a student's uploaded CV, with the "uploaded by the student, not verified" label. Rendered
// only where the server decided the viewer may download it (cvAccess()); the route checks again on every click.
// A plain link (not next/link): the route answers with a redirect to a 60-second signed URL.
export function CvFileLink({ studentId, size = "sm" }: { studentId: string; size?: "sm" | "small" }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <a
        href={`/api/cv/${studentId}/file`}
        rel="nofollow noopener"
        className={`inline-flex w-fit items-center gap-1.5 font-medium text-primary-text underline-offset-4 hover:underline ${size === "sm" ? "text-sm" : "text-small"}`}
      >
        <FileDown className="size-4" aria-hidden />
        {t.talent.downloadCv}
      </a>
      <span className="text-small text-muted-foreground">({t.talent.downloadCvLabel})</span>
    </span>
  );
}

import type { Metadata } from "next";

import { CvPageBody } from "@/components/cv/cv-page";
import { t } from "@/i18n";

// The name is not put in the title: the page metadata would otherwise read the CV before the access check.
export const metadata: Metadata = {
  title: `${t.cv.title} · ${t.common.appName}`,
  robots: { index: false, follow: false },
};

// One CV, as this viewer may see it (CLAUDE.md rule 12).
export default function CvViewPage({ params }: PageProps<"/cv/[studentId]">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CvPageBody params={params} print={false} />
    </div>
  );
}

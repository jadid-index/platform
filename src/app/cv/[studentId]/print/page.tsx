import type { Metadata } from "next";

import { CvPageBody } from "@/components/cv/cv-page";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: `${t.cv.title} · ${t.common.appName}`,
  robots: { index: false, follow: false },
};

// Print version: an A4 sheet without the navigation (data-print-page, see globals.css). Same access as the view.
export default function CvPrintPage({ params }: PageProps<"/cv/[studentId]/print">) {
  return (
    <div data-print-page className="flex w-full flex-col gap-4">
      <CvPageBody params={params} print />
    </div>
  );
}

"use client";

import { Printer } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

// Screen-only actions above a CV. The browser's print dialog saves it as a PDF ("Save as PDF").
export function CvToolbar({ studentId, print }: { studentId: string; print: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      {print ? (
        <Link href={`/cv/${studentId}`} className="text-sm text-primary-text underline-offset-4 hover:underline">
          {t.cv.printBack}
        </Link>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <p className="text-small text-muted-foreground">{t.cv.printHint}</p>
        {print ? (
          <Button type="button" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            {t.cv.print}
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={`/cv/${studentId}/print`}>
              <Printer className="size-4" aria-hidden />
              {t.cv.print}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

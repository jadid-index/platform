"use client";

import { Copy, ExternalLink, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

// The CV's address, to share; it opens only for the viewers the visibility allows (others get "not found").
export function CvShare({ studentId }: { studentId: string }) {
  const path = `/cv/${studentId}`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-h2">{t.cv.shareTitle}</CardTitle>
        <CardDescription>{t.cv.shareHint}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 px-5">
        <Button type="button" variant="outline" onClick={copy}>
          <Copy className="size-4" aria-hidden />
          <span aria-live="polite">{copied ? t.cv.copied : t.cv.copyLink}</span>
        </Button>
        <Button asChild variant="outline">
          <Link href={path} target="_blank">
            <ExternalLink className="size-4" aria-hidden />
            {t.cv.open}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`${path}/print`} target="_blank">
            <Printer className="size-4" aria-hidden />
            {t.cv.print}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

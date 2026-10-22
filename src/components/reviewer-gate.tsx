import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { t } from "@/i18n";
import { requireReviewer } from "@/lib/auth";

// Server-side access check for reviewer pages. Returns the reviewer id, or an element to render instead.
export async function checkReviewerPage(): Promise<{ reviewerId: string } | { denied: React.ReactElement }> {
  const auth = await requireReviewer();
  if (auth.ok) return { reviewerId: auth.userId };
  if (auth.status === 401) redirect("/login");
  return {
    denied: (
      <Alert>
        <AlertDescription>{t.review.forbidden}</AlertDescription>
      </Alert>
    ),
  };
}

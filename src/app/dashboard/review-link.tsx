import { ClipboardCheck } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { getProfileAccess } from "@/lib/db";

// Header link to the review queue, rendered only for active reviewers and admins (checked on the server).
// It is a convenience only: /review and /api/review check access themselves.
export async function ReviewLink() {
  const user = await getCurrentUser();
  if (!user) return null;
  let access: Awaited<ReturnType<typeof getProfileAccess>>;
  try {
    access = await getProfileAccess(user.id);
  } catch (error) {
    console.error("review link access check failed", error);
    return null;
  }
  if (!access || access.status !== "active" || (access.role !== "reviewer" && access.role !== "admin")) return null;

  return (
    <Button asChild variant="outline" size="lg">
      <Link href="/review">
        <ClipboardCheck aria-hidden />
        {t.dashboard.reviewLink}
      </Link>
    </Button>
  );
}

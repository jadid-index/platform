import { z } from "zod";

import { apiError, readJson } from "@/lib/api";
import { requireReviewer } from "@/lib/auth";
import { rejectSubmission } from "@/lib/db";
import { reviewResponse } from "@/lib/review-api";
import { rejectBodySchema } from "@/lib/validation";

// Body { reason } (required). reject_submission() records the reason, which the student sees.
export async function POST(request: Request, ctx: RouteContext<"/api/review/submissions/[id]/reject">) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return apiError(400, "invalid_body");
  const body = rejectBodySchema.safeParse(await readJson(request));
  if (!body.success) return apiError(400, "reason_required");

  try {
    const auth = await requireReviewer();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const outcome = await rejectSubmission(id.data, auth.userId, body.data.reason);
    return reviewResponse(outcome, "rejected");
  } catch (error) {
    console.error("reject failed", error);
    return apiError(500, "server_error");
  }
}

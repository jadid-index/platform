import { revalidateTag } from "next/cache";
import { z } from "zod";

import { apiError, readJson } from "@/lib/api";
import { requireReviewer } from "@/lib/auth";
import { approveSubmission, getAchievementType, LEADERBOARD_TAG } from "@/lib/db";
import { reviewResponse } from "@/lib/review-api";
import { approveBodySchema } from "@/lib/validation";

// Body { type_id, level, result }. The reviewer may correct the student's choice.
// Points and the yearly cap are applied by approve_submission() in SQL.
export async function POST(request: Request, ctx: RouteContext<"/api/review/submissions/[id]/approve">) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return apiError(400, "invalid_body");
  const body = approveBodySchema.safeParse(await readJson(request));
  if (!body.success) return apiError(400, "invalid_body");

  try {
    const auth = await requireReviewer();
    if (!auth.ok) return apiError(auth.status, auth.error);

    const type = await getAchievementType(body.data.type_id);
    if (!type) return apiError(400, "invalid_combination");
    const result = type.has_placement ? body.data.result : "confirmed";
    if (!result) return apiError(400, "invalid_combination");

    const outcome = await approveSubmission(id.data, auth.userId, type.id, body.data.level, result);
    // New points should show on the public leaderboard right away, not after the 30 s cache.
    if (outcome.ok) revalidateTag(LEADERBOARD_TAG, { expire: 0 });
    return reviewResponse(outcome, "approved");
  } catch (error) {
    console.error("approve failed", error);
    return apiError(500, "server_error");
  }
}

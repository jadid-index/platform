import { revalidateTag } from "next/cache";

import { apiError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { LEADERBOARD_TAG, saveTier } from "@/lib/db";
import { rubricResponse } from "@/lib/rubric-api";
import { tierBodySchema } from "@/lib/validation";

// Admin only. Adds a tier. Body { code, label: { uz, en? }, min_points, reason }.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const body = tierBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome = await saveTier(auth.userId, null, body.data);
    // Tiers are computed live, so every public tier may change.
    if (outcome.ok) revalidateTag(LEADERBOARD_TAG, { expire: 0 });
    return rubricResponse(outcome, "create tier", (tier) => ({ tier }));
  } catch (error) {
    console.error("create tier failed", error);
    return apiError(500, "server_error");
  }
}

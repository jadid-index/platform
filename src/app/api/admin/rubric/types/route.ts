import { revalidateTag } from "next/cache";

import { apiError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { LEADERBOARD_TAG, saveAchievementType } from "@/lib/db";
import { rubricResponse } from "@/lib/rubric-api";
import { typeBodySchema } from "@/lib/validation";

// Admin only. Creates a type (active, no points cells yet). Body: type fields + reason.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const body = typeBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome = await saveAchievementType(auth.userId, null, body.data);
    if (outcome.ok) revalidateTag(LEADERBOARD_TAG, { expire: 0 });
    return rubricResponse(outcome, "create type", (type) => ({ type }));
  } catch (error) {
    console.error("create type failed", error);
    return apiError(500, "server_error");
  }
}

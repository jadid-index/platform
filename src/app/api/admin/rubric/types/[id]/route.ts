import { revalidateTag } from "next/cache";
import { z } from "zod";

import { apiError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { deleteAchievementType, LEADERBOARD_TAG, saveAchievementType, setAchievementTypeActive } from "@/lib/db";
import { rubricResponse } from "@/lib/rubric-api";
import { reasonBodySchema, typePatchSchema } from "@/lib/validation";

const typeId = z.coerce.number().int().positive().max(32767);

// Admin only. Body: all type fields + reason (edit), or { active, reason } (activate / deactivate).
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/rubric/types/[id]">) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const id = typeId.safeParse((await ctx.params).id);
    if (!id.success) return apiError(400, "invalid_body");
    const body = typePatchSchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome =
      "active" in body.data
        ? await setAchievementTypeActive(auth.userId, id.data, body.data.active, body.data.reason)
        : await saveAchievementType(auth.userId, id.data, body.data);
    // Type names show on public profiles (cached); points of existing reviews never change.
    if (outcome.ok) revalidateTag(LEADERBOARD_TAG, { expire: 0 });
    return rubricResponse(outcome, "update type", (type) => ({ type }));
  } catch (error) {
    console.error("update type failed", error);
    return apiError(500, "server_error");
  }
}

// Admin only. Body { reason }. Only a type no submission or review refers to can be deleted; otherwise deactivate it.
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/rubric/types/[id]">) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const id = typeId.safeParse((await ctx.params).id);
    if (!id.success) return apiError(400, "invalid_body");
    const body = reasonBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome = await deleteAchievementType(auth.userId, id.data, body.data.reason);
    return rubricResponse(outcome, "delete type", () => ({ deleted: true }));
  } catch (error) {
    console.error("delete type failed", error);
    return apiError(500, "server_error");
  }
}

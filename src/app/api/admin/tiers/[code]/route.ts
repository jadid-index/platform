import { revalidateTag } from "next/cache";
import { z } from "zod";

import { apiError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { deleteTier, LEADERBOARD_TAG, saveTier } from "@/lib/db";
import { rubricResponse } from "@/lib/rubric-api";
import { reasonBodySchema, TIER_CODE, tierBodySchema } from "@/lib/validation";

// "S+" arrives as "S%2B" in the URL; decode it once, safely.
function tierCode(raw: string) {
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return z.never().safeParse(raw);
  }
  return z.string().regex(TIER_CODE).safeParse(value);
}

// Admin only. Edits a tier (code, label, min_points). Body as for POST, plus reason.
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/tiers/[code]">) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const code = tierCode((await ctx.params).code);
    if (!code.success) return apiError(400, "invalid_body");
    const body = tierBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome = await saveTier(auth.userId, code.data, body.data);
    if (outcome.ok) revalidateTag(LEADERBOARD_TAG, { expire: 0 });
    return rubricResponse(outcome, "update tier", (tier) => ({ tier }));
  } catch (error) {
    console.error("update tier failed", error);
    return apiError(500, "server_error");
  }
}

// Admin only. Body { reason }. The last tier cannot be deleted.
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/tiers/[code]">) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const code = tierCode((await ctx.params).code);
    if (!code.success) return apiError(400, "invalid_body");
    const body = reasonBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome = await deleteTier(auth.userId, code.data, body.data.reason);
    if (outcome.ok) revalidateTag(LEADERBOARD_TAG, { expire: 0 });
    return rubricResponse(outcome, "delete tier", () => ({ deleted: true }));
  } catch (error) {
    console.error("delete tier failed", error);
    return apiError(500, "server_error");
  }
}

import { z } from "zod";

import { apiError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { setCategoryCap } from "@/lib/db";
import { rubricResponse } from "@/lib/rubric-api";
import { capBodySchema } from "@/lib/validation";

const code = z.string().regex(/^[a-z0-9_]{1,40}$/);

// Admin only. Body { yearly_cap, reason }. The cap cannot go below any points cell or base points of the category.
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/rubric/categories/[code]">) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const category = code.safeParse((await ctx.params).code);
    if (!category.success) return apiError(400, "invalid_body");
    const body = capBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome = await setCategoryCap(auth.userId, category.data, body.data.yearly_cap, body.data.reason);
    return rubricResponse(outcome, "set cap", (c) => ({ category: c }));
  } catch (error) {
    console.error("set cap failed", error);
    return apiError(500, "server_error");
  }
}

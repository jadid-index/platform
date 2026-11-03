import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { LEADERBOARD_TAG, setUserRole, setUserStatus } from "@/lib/db";
import { adminUserPatchSchema } from "@/lib/validation";

const STATUS: Record<string, number> = {
  forbidden: 403,
  not_found: 404,
  last_admin: 409,
  student_fields_missing: 409,
  invalid_body: 400,
};

// Admin only. Body { role } or { status: "active" | "hidden" }, one change per request.
// The SQL function checks the admin again, protects the last admin and writes the audit_log row.
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);

    const id = z.uuid().safeParse((await ctx.params).id);
    if (!id.success) return apiError(400, "invalid_body");
    const body = adminUserPatchSchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome =
      "role" in body.data
        ? await setUserRole(auth.userId, id.data, body.data.role)
        : await setUserStatus(auth.userId, id.data, body.data.status);

    if (!outcome.ok) {
      if (outcome.code === "sql_error") {
        console.error("admin change failed with unknown SQL error:", outcome.message);
        return apiError(500, "server_error");
      }
      return apiError(STATUS[outcome.code] ?? 400, outcome.code);
    }
    // Role and status both decide who is on the public leaderboard.
    if (outcome.changed) revalidateTag(LEADERBOARD_TAG, { expire: 0 });
    return NextResponse.json(
      { old: outcome.old, new: outcome.new, changed: outcome.changed },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("admin change failed", error);
    return apiError(500, "server_error");
  }
}

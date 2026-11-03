import { apiError, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { setRubricPoints } from "@/lib/db";
import { rubricResponse } from "@/lib/rubric-api";
import { pointsBodySchema } from "@/lib/validation";

// Admin only. Body { cells: [{ type_id, level, result, points | null }], reason }. All or nothing.
// Applies to future approvals only: approved reviews keep the points they were given.
export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const body = pointsBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome = await setRubricPoints(auth.userId, body.data.cells, body.data.reason);
    return rubricResponse(outcome, "set points", (changed) => ({ changed }));
  } catch (error) {
    console.error("set points failed", error);
    return apiError(500, "server_error");
  }
}

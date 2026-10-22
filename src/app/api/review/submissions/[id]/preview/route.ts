import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireReviewer } from "@/lib/auth";
import { getAchievementType, getPointsPreview } from "@/lib/db";
import { previewQuerySchema } from "@/lib/validation";

// GET ?type_id=&level=&result= -> points preview for that combination (rubric points, points already
// held in the category and academic year, points after the cap). Used when the reviewer corrects the type.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/review/submissions/[id]/preview">) {
  const id = z.uuid().safeParse((await ctx.params).id);
  const query = previewQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!id.success || !query.success) return apiError(400, "invalid_body");

  try {
    const auth = await requireReviewer();
    if (!auth.ok) return apiError(auth.status, auth.error);

    const type = await getAchievementType(query.data.type_id);
    if (!type) return apiError(400, "invalid_combination");
    const result = type.has_placement ? query.data.result : "confirmed";
    if (!result) return apiError(400, "invalid_combination");

    const preview = await getPointsPreview(id.data, type.id, query.data.level, result);
    if (!preview) return apiError(404, "not_found");
    return NextResponse.json(preview);
  } catch (error) {
    console.error("preview failed", error);
    return apiError(500, "server_error");
  }
}

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { LEADERBOARD_TAG, setFileVisibility } from "@/lib/db";
import { visibilityBodySchema } from "@/lib/validation";

// The owner chooses who may open the document of an approved work. Body { visibility, confirm? }.
// 'public' needs confirm: true; set_file_visibility() stores public_confirmed_at and refuses flagged files.
const ERRORS: Record<string, [number, string]> = {
  "submission not found": [404, "not_found"],
  "submission is not approved": [409, "not_approved"],
  "file is flagged as sensitive": [409, "sensitive_locked"],
  "confirmation required": [400, "confirmation_required"],
};

export async function PATCH(request: Request, ctx: RouteContext<"/api/submissions/[id]/visibility">) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, "not_found");
  const body = visibilityBodySchema.safeParse(await readJson(request));
  if (!body.success) {
    const needsConfirm = body.error.issues.some((i) => i.path[0] === "confirm");
    return apiError(400, needsConfirm ? "confirmation_required" : "invalid_body");
  }

  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const outcome = await setFileVisibility(auth.userId, id.data, body.data.visibility, body.data.confirm === true);
    if (!outcome.ok) {
      const [status, code] = ERRORS[outcome.message] ?? [409, "conflict"];
      return apiError(status, code);
    }
    // The work page shows the "View document" link for public files.
    revalidateTag(LEADERBOARD_TAG, { expire: 0 });
    return NextResponse.json({ id: id.data, visibility: body.data.visibility });
  } catch (error) {
    console.error("set visibility failed", error);
    return apiError(500, "server_error");
  }
}

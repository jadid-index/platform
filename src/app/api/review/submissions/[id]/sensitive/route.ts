import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson } from "@/lib/api";
import { requireReviewer } from "@/lib/auth";
import { LEADERBOARD_TAG, setSensitiveFlag } from "@/lib/db";
import { sensitiveBodySchema } from "@/lib/validation";

// Reviewers and admins mark a document as showing sensitive data (ID number, passport, address, phone).
// Body { flag }. Flagging makes the file private for good: only the owner, reviewers and admins can open it.
const ERRORS: Record<string, [number, string]> = {
  "submission not found": [404, "not_found"],
  "not an active reviewer": [403, "forbidden"],
  "reviewers cannot review their own submissions": [403, "own_submission"],
};

export async function PATCH(request: Request, ctx: RouteContext<"/api/review/submissions/[id]/sensitive">) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, "not_found");
  const body = sensitiveBodySchema.safeParse(await readJson(request));
  if (!body.success) return apiError(400, "invalid_body");

  try {
    const auth = await requireReviewer();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const outcome = await setSensitiveFlag(auth.userId, id.data, body.data.flag);
    if (!outcome.ok) {
      const [status, code] = ERRORS[outcome.message] ?? [409, "conflict"];
      return apiError(status, code);
    }
    revalidateTag(LEADERBOARD_TAG, { expire: 0 });
    return NextResponse.json({ id: id.data, flag: body.data.flag });
  } catch (error) {
    console.error("set sensitive flag failed", error);
    return apiError(500, "server_error");
  }
}

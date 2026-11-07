import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { setOpenToWork } from "@/lib/db";
import { NO_STORE } from "@/lib/talent";
import { openToWorkBodySchema } from "@/lib/validation";

// Students only. Body { open_to_work: boolean }: show or hide the student in the employers' talent directory.
export async function PATCH(request: Request) {
  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const body = openToWorkBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");
    const outcome = await setOpenToWork(auth.userId, body.data.open_to_work);
    if (!outcome.ok) return apiError(403, "profile_not_active");
    return NextResponse.json({ open_to_work: outcome.data }, { headers: NO_STORE });
  } catch (error) {
    console.error("set open_to_work failed", error);
    return apiError(500, "server_error");
  }
}

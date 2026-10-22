import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { withdrawOwnSubmission } from "@/lib/db";

// Withdraws the student's own submission while it is still pending. This frees the file hash.
export async function POST(_request: Request, ctx: RouteContext<"/api/submissions/[id]/withdraw">) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return apiError(400, "invalid_body");

  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    if (!(await withdrawOwnSubmission(id.data, auth.userId))) return apiError(409, "not_pending");
    return NextResponse.json({ id: id.data, status: "withdrawn" });
  } catch (error) {
    console.error("withdraw failed", error);
    return apiError(500, "server_error");
  }
}

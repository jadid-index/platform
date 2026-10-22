import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { getPublicStudent } from "@/lib/db";

// Public. A student's approved works from public_works. Never returns files or file paths.
export async function GET(_request: Request, ctx: RouteContext<"/api/leaderboard/[studentId]">) {
  const id = z.uuid().safeParse((await ctx.params).studentId);
  if (!id.success) return apiError(404, "not_found");

  try {
    const student = await getPublicStudent(id.data);
    if (!student) return apiError(404, "not_found");
    return NextResponse.json(student);
  } catch (error) {
    console.error("public student failed", error);
    return apiError(500, "server_error");
  }
}

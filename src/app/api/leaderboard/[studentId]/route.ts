import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { getPublicStudent } from "@/lib/db";

// Public. Tier (best year and this year), name, faculty and approved works with level and result.
// Never points, ranks, files or file paths (CLAUDE.md rule 11).
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

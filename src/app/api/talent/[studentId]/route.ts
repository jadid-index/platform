import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { loadTalentStudent, NO_STORE, requireTalentViewer } from "@/lib/talent";

// Employers and admins only. One open-to-work student: public fields, approved works (with can_view_file for this
// viewer) and the employer's latest request. The contact detail appears only after the student accepted.
// Each employer view writes an audit_log row.
export async function GET(_request: Request, ctx: RouteContext<"/api/talent/[studentId]">) {
  try {
    const auth = await requireTalentViewer();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const id = z.uuid().safeParse((await ctx.params).studentId);
    if (!id.success) return apiError(404, "not_found");
    const student = await loadTalentStudent(auth, id.data);
    if (!student) return apiError(404, "not_found");
    return NextResponse.json(student, { headers: NO_STORE });
  } catch (error) {
    console.error("talent student failed", error);
    return apiError(500, "server_error");
  }
}

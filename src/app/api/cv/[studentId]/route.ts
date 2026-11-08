import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { CV_HEADERS, loadCvForViewer } from "@/lib/cv";
import { getFileViewer } from "@/lib/file-viewer";

// One CV as the caller may see it (cvAccess() in src/lib/cv-access.ts, CLAUDE.md rule 12). Anyone may call it;
// whoever may not open the CV gets the same 404 as for a CV that does not exist. Contact fields and the course
// are left out unless allowed. Employer and admin views are logged. Never cached, never indexed.
export async function GET(_request: Request, ctx: RouteContext<"/api/cv/[studentId]">) {
  try {
    const id = z.uuid().safeParse((await ctx.params).studentId);
    if (!id.success) return apiError(404, "not_found");
    const cv = await loadCvForViewer(id.data, await getFileViewer(), "api");
    if (!cv) return NextResponse.json({ error: "not_found" }, { status: 404, headers: CV_HEADERS });
    return NextResponse.json(cv, { headers: CV_HEADERS });
  } catch (error) {
    console.error("get cv failed", error);
    return apiError(500, "server_error");
  }
}

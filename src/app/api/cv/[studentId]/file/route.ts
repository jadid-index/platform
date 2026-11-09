import { NextResponse } from "next/server";
import { z } from "zod";

import { CV_FILE_HEADERS, cvFileObjectForViewer } from "@/lib/cv";
import { CV_FILE_REQUESTS_PER_WINDOW, CV_FILE_URL_SECONDS, CV_FILE_WINDOW_MINUTES } from "@/lib/cv-file";
import { countCvFileAccessSince, createCvReadUrl, logCvFileAccess } from "@/lib/db";
import { fileClientKey, getFileViewer } from "@/lib/file-viewer";

// GET /api/cv/:studentId/file -> 302 to a signed URL of the student's uploaded CV that expires in 60 seconds.
// Same access matrix as the typed CV (cvAccess(), CLAUDE.md rule 12); whoever may not download it gets the same
// 404 as for a student without a file. Employer and admin downloads are written to audit_log. Rate limited like
// /api/files. The response never contains the storage object name except inside the signed URL itself.
function error(status: number, code: string) {
  return NextResponse.json({ error: code }, { status, headers: CV_FILE_HEADERS });
}

export async function GET(request: Request, ctx: RouteContext<"/api/cv/[studentId]/file">) {
  const id = z.uuid().safeParse((await ctx.params).studentId);
  if (!id.success) return error(404, "not_found");

  try {
    const viewer = await getFileViewer();
    const clientKey = fileClientKey(viewer, request.headers);
    const since = new Date(Date.now() - CV_FILE_WINDOW_MINUTES * 60 * 1000).toISOString();
    if ((await countCvFileAccessSince(clientKey, since)) >= CV_FILE_REQUESTS_PER_WINDOW) return error(429, "rate_limited");
    // Every attempt counts, also refused ones, so ids cannot be probed quickly.
    await logCvFileAccess({ student_id: id.data, viewer_id: viewer.kind === "user" ? viewer.id : null, client_key: clientKey });

    const object = await cvFileObjectForViewer(id.data, viewer);
    if (!object) return error(404, "not_found");
    const url = await createCvReadUrl(object, CV_FILE_URL_SECONDS);
    return NextResponse.redirect(url, { status: 302, headers: CV_FILE_HEADERS });
  } catch (err) {
    console.error("cv file access failed", err instanceof Error ? err.message : "unknown");
    return error(500, "server_error");
  }
}

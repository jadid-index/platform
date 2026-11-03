import { NextResponse } from "next/server";
import { z } from "zod";

import { countFileAccessSince, createProofReadUrl, getFileAccess, logFileAccess } from "@/lib/db";
import { canViewFile, FILE_REQUESTS_PER_WINDOW, FILE_URL_SECONDS, FILE_WINDOW_MINUTES } from "@/lib/file-access";
import { fileClientKey, getFileViewer } from "@/lib/file-viewer";

// GET /api/files/:submissionId -> 302 to a signed URL of the proof that expires in 60 seconds (CLAUDE.md rule 4).
// Approved submissions only; who may open it is decided by canViewFile() (visibility, sensitive flag, viewer).
// The response never contains the storage path. Not found and not allowed look the same to signed-out viewers.
const HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

function error(status: number, code: string) {
  return NextResponse.json({ error: code }, { status, headers: HEADERS });
}

export async function GET(request: Request, ctx: RouteContext<"/api/files/[submissionId]">) {
  const id = z.uuid().safeParse((await ctx.params).submissionId);
  if (!id.success) return error(404, "not_found");

  try {
    const viewer = await getFileViewer();
    const clientKey = fileClientKey(viewer, request.headers);
    const since = new Date(Date.now() - FILE_WINDOW_MINUTES * 60 * 1000).toISOString();
    if ((await countFileAccessSince(clientKey, since)) >= FILE_REQUESTS_PER_WINDOW) return error(429, "rate_limited");
    // Every attempt counts, also refused ones, so ids cannot be probed quickly.
    await logFileAccess({ submission_id: id.data, viewer_id: viewer.kind === "user" ? viewer.id : null, client_key: clientKey });

    const file = await getFileAccess(id.data);
    if (!file || file.status !== "approved") return error(404, "not_found");
    if (!canViewFile(file, viewer)) return viewer.kind === "anonymous" ? error(404, "not_found") : error(403, "forbidden");

    const url = await createProofReadUrl(file.file_path, FILE_URL_SECONDS);
    return NextResponse.redirect(url, { status: 302, headers: HEADERS });
  } catch (err) {
    console.error("file access failed", err);
    return error(500, "server_error");
  }
}

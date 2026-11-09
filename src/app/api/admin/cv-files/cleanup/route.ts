import { connection, NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { cleanupCvUploads } from "@/lib/cv-file";
import { logAdminCvCleanup } from "@/lib/db";

// Admin only. Deletes uploaded-CV objects that are not a student's current file: uploads never finalized within
// an hour, files whose delete failed earlier, and files of deleted accounts (cleanupCvUploads()). The same job runs
// from the shell with `npm run cleanup:cv-uploads`. Returns { removed }; writes one audit row.
export async function POST() {
  await connection();
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const removed = await cleanupCvUploads();
    await logAdminCvCleanup(auth.userId, removed);
    return NextResponse.json({ removed }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("cv cleanup failed", error);
    return apiError(500, "server_error");
  }
}

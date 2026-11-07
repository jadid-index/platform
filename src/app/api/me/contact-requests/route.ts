import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { listStudentContactRequests } from "@/lib/db";
import { NO_STORE } from "@/lib/talent";

// Students only. Requests the student received, pending first. No email is sent (rule 6); this list is the inbox.
export async function GET() {
  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const rows = await listStudentContactRequests(auth.userId);
    return NextResponse.json({ rows, pending: rows.filter((r) => r.status === "pending").length }, { headers: NO_STORE });
  } catch (error) {
    console.error("list received contact requests failed", error);
    return apiError(500, "server_error");
  }
}

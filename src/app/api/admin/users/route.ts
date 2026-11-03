import { connection, NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/db";
import { adminUsersQuerySchema } from "@/lib/validation";

// Admin only. Query: q (name or email), role, status, limit, offset. Returns emails, so never cached.
export async function GET(request: Request) {
  // Per request, never prerendered at build time (it reads the session cookies).
  await connection();
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);

    const query = adminUsersQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return apiError(400, "invalid_query");

    const { rows, total } = await listUsersForAdmin(query.data);
    return NextResponse.json(
      { total, limit: query.data.limit, offset: query.data.offset, rows },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("admin users list failed", error);
    return apiError(500, "server_error");
  }
}

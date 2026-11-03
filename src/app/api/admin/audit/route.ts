import { connection, NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { listAuditActions, listAuditLog } from "@/lib/db";
import { adminAuditQuerySchema } from "@/lib/validation";

// Admin only, read-only. Query: actor (name, email or id), action, from, to (YYYY-MM-DD, Tashkent days), limit, offset.
export async function GET(request: Request) {
  // Per request, never prerendered at build time (it reads the session cookies).
  await connection();
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);

    const query = adminAuditQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return apiError(400, "invalid_query");

    const [{ rows, total }, actions] = await Promise.all([listAuditLog(query.data), listAuditActions()]);
    return NextResponse.json(
      { total, limit: query.data.limit, offset: query.data.offset, actions, rows },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("admin audit list failed", error);
    return apiError(500, "server_error");
  }
}

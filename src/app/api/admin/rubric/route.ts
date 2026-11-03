import { connection, NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { getRubricForAdmin } from "@/lib/db";
import { NO_STORE } from "@/lib/rubric-api";

// Admin only. Categories with caps, every type (inactive included, with in_use) and every points cell.
export async function GET() {
  // Per request, never prerendered at build time (it reads the session cookies).
  await connection();
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return apiError(auth.status, auth.error);
    return NextResponse.json(await getRubricForAdmin(), { headers: NO_STORE });
  } catch (error) {
    console.error("admin rubric failed", error);
    return apiError(500, "server_error");
  }
}

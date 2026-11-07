import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireTalentViewer } from "@/lib/auth";
import { listTalent } from "@/lib/db";
import { NO_STORE } from "@/lib/talent";
import { talentQuerySchema } from "@/lib/validation";

// Employers and admins only. Active students with open_to_work = true, in public order (tier, then name).
// Query: faculty_id, tier, category, page. Never points, rank or contact details (CLAUDE.md rules 5 and 11).
export async function GET(request: Request) {
  try {
    const auth = await requireTalentViewer();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const query = talentQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await listTalent(query), { headers: NO_STORE });
  } catch (error) {
    console.error("talent list failed", error);
    return apiError(500, "server_error");
  }
}

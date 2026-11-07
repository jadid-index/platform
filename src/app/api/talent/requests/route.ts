import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireEmployer } from "@/lib/auth";
import { createContactRequest, listEmployerContactRequests } from "@/lib/db";
import { contactRequestsDailyCap, NO_STORE } from "@/lib/talent";
import { CONTACT_ERRORS, contactRequestBodySchema } from "@/lib/validation";

// Employers only. The employer's sent requests; shared_contact only for accepted requests of active students.
export async function GET() {
  try {
    const auth = await requireEmployer();
    if (!auth.ok) return apiError(auth.status, auth.error);
    return NextResponse.json({ rows: await listEmployerContactRequests(auth.userId) }, { headers: NO_STORE });
  } catch (error) {
    console.error("list contact requests failed", error);
    return apiError(500, "server_error");
  }
}

// Employers only. Body { student_id, message (1-500) }. create_contact_request() enforces one pending request per
// pair, the 30-day cooldown after a decline, 10 a day (30 when verified) and the global daily cap.
export async function POST(request: Request) {
  try {
    const auth = await requireEmployer();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const body = contactRequestBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome = await createContactRequest(auth.userId, body.data.student_id, body.data.message, contactRequestsDailyCap());
    if (!outcome.ok) {
      const status = CONTACT_ERRORS[outcome.code];
      if (!status) {
        console.error("contact request failed with unknown SQL error:", outcome.code);
        return apiError(500, "server_error");
      }
      return apiError(status, outcome.code);
    }
    return NextResponse.json({ id: outcome.data }, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error("create contact request failed", error);
    return apiError(500, "server_error");
  }
}

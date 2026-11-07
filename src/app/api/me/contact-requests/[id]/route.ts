import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { respondContactRequest } from "@/lib/db";
import { NO_STORE } from "@/lib/talent";
import { CONTACT_ERRORS, contactResponseBodySchema } from "@/lib/validation";

// Students only, own pending requests. Body { action: "decline" } or { action: "accept", kind, value } with
// kind phone | telegram | email. Only on accept does the employer see that one contact detail.
export async function PATCH(request: Request, ctx: RouteContext<"/api/me/contact-requests/[id]">) {
  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const id = z.uuid().safeParse((await ctx.params).id);
    if (!id.success) return apiError(404, "not_found");
    const body = contactResponseBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");

    const outcome = await respondContactRequest(auth.userId, id.data, body.data);
    if (!outcome.ok) {
      const status = CONTACT_ERRORS[outcome.code];
      if (!status) {
        console.error("contact response failed with unknown SQL error:", outcome.code);
        return apiError(500, "server_error");
      }
      return apiError(status, outcome.code);
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error("respond to contact request failed", error);
    return apiError(500, "server_error");
  }
}

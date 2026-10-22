import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { isEmailDomainAllowed } from "@/lib/db";
import { checkEmailBodySchema, emailDomain } from "@/lib/validation";

// Called by the sign-up form before supabase.auth.signUp(), so students get a clear message early.
// This is a convenience check only; the profiles trigger is the real gate.
export async function POST(request: Request) {
  const parsed = checkEmailBodySchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError(400, "invalid_email");

  try {
    const allowed = await isEmailDomainAllowed(emailDomain(parsed.data.email));
    return NextResponse.json({ allowed });
  } catch (error) {
    console.error("check-email failed", error);
    return apiError(500, "server_error");
  }
}

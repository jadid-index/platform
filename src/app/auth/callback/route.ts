import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/redirect";
import { createSessionClient } from "@/lib/supabase/server";

// OAuth (Google) redirect target, PKCE flow: exchange the code for a session cookie, then go to `next`.
// Users without a profile are sent on to /onboarding by the proxy.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  // A provider error (for example the user cancelled on Google's screen) arrives without a code.
  if (code && !searchParams.get("error")) {
    const supabase = await createSessionClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.nextUrl.origin));
    console.error("oauth code exchange failed", error.code ?? error.message);
  }

  return NextResponse.redirect(new URL("/auth/auth-code-error", request.nextUrl.origin));
}

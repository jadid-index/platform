import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createSessionClient } from "@/lib/supabase/server";

// Target of the email confirmation link. Supports both link styles:
// - ?token_hash=...&type=email (recommended email template; works when the link is opened on another device)
// - ?code=... (default PKCE link; only works in the browser that signed up)
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createSessionClient();
  let ok = false;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const target = request.nextUrl.clone();
  target.search = "";
  if (ok) {
    target.pathname = "/onboarding";
  } else {
    target.pathname = "/login";
    target.searchParams.set("error", "confirm_failed");
  }
  return NextResponse.redirect(target);
}

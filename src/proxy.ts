import { NextResponse, type NextRequest } from "next/server";

import { getProfileAccess } from "@/lib/db";
import { updateSession } from "@/lib/supabase/proxy";

const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/achievements", "/review"];
// Pages where a signed-in user's profile decides where they belong. Public pages (/, /students) are never redirected.
const PROFILE_ROUTED_PREFIXES = [...PROTECTED_PREFIXES, "/login", "/signup"];

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!userId) {
    return matches(pathname, PROTECTED_PREFIXES) ? redirectTo(request, response, "/login") : response;
  }
  if (!matches(pathname, PROFILE_ROUTED_PREFIXES)) return response;

  // Signed in: no profile yet (for example a new Google user) -> onboarding; profile exists -> away from
  // onboarding and the auth pages. Pages and route handlers still check access themselves; if this lookup
  // fails, let the request through to them.
  let hasProfile: boolean;
  try {
    hasProfile = (await getProfileAccess(userId)) !== null;
  } catch (error) {
    console.error("proxy profile lookup failed", error);
    return response;
  }
  const onOnboarding = matches(pathname, ["/onboarding"]);
  if (!hasProfile && !onOnboarding) return redirectTo(request, response, "/onboarding");
  if (hasProfile && (onOnboarding || matches(pathname, ["/login", "/signup"]))) {
    return redirectTo(request, response, "/dashboard");
  }
  return response;
}

function redirectTo(request: NextRequest, response: NextResponse, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const redirect = NextResponse.redirect(url);
  // Keep any refreshed or cleared auth cookies.
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

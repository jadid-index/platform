import { NextResponse, type NextRequest } from "next/server";

import { getProfileAccess } from "@/lib/db";
import { updateSession } from "@/lib/supabase/proxy";

const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/achievements", "/review", "/admin"];
// Admin pages and admin API: only an active admin gets through. Checked here and again in every page and handler.
const ADMIN_PREFIXES = ["/admin", "/api/admin"];
// Pages where a signed-in user's profile decides where they belong. Public pages (/, /students) are never redirected.
const PROFILE_ROUTED_PREFIXES = [...PROTECTED_PREFIXES, "/login", "/signup"];

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (matches(pathname, ADMIN_PREFIXES)) return adminGate(request, response, userId);

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

// Fails closed: if the profile lookup fails, the request is refused, unlike the other protected pages.
async function adminGate(request: NextRequest, response: NextResponse, userId: string | null) {
  const isApi = matches(request.nextUrl.pathname, ["/api/admin"]);
  if (!userId) return isApi ? deny(response, 401, "unauthorized") : redirectTo(request, response, "/login");
  let isAdmin = false;
  try {
    const access = await getProfileAccess(userId);
    isAdmin = access?.role === "admin" && access.status === "active";
  } catch (error) {
    console.error("proxy admin lookup failed", error);
    return isApi ? deny(response, 503, "server_error") : redirectTo(request, response, "/dashboard");
  }
  if (isAdmin) return response;
  return isApi ? deny(response, 403, "forbidden") : redirectTo(request, response, "/dashboard");
}

function deny(response: NextResponse, status: number, error: string) {
  const res = NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
  response.cookies.getAll().forEach((cookie) => res.cookies.set(cookie));
  return res;
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

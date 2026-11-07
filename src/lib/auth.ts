import "server-only";

import { getProfileAccess } from "@/lib/db";
import { createSessionClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; user_metadata: Record<string, unknown> };

// Returns the signed-in user from the verified JWT (getClaims() checks the signature), or null.
// Never authorize with getSession(): it returns whatever is in the cookie without verifying it.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, user_metadata: (data.claims.user_metadata as Record<string, unknown>) ?? {} };
}

// For student-only route handlers: the user must be signed in and have an active student profile.
export async function requireActiveStudent(): Promise<
  { ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "unauthorized" };
  const access = await getProfileAccess(user.id);
  if (!access) return { ok: false, status: 403, error: "no_profile" };
  if (access.role !== "student" || access.status !== "active") {
    return { ok: false, status: 403, error: "profile_not_active" };
  }
  return { ok: true, userId: user.id };
}

// For reviewer pages and route handlers: role reviewer or admin, and an active profile.
export async function requireReviewer(): Promise<
  { ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "unauthorized" };
  const access = await getProfileAccess(user.id);
  if (!access || access.status !== "active" || (access.role !== "reviewer" && access.role !== "admin")) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, userId: user.id };
}

// For /admin pages and /api/admin route handlers: role admin and an active profile.
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "unauthorized" };
  const access = await getProfileAccess(user.id);
  if (!access || access.status !== "active" || access.role !== "admin") {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, userId: user.id };
}

// For employer-only route handlers (sending contact requests, the sent list): role employer and an active profile.
// Students, reviewers and admins get 403 (CLAUDE.md rule 10).
export async function requireEmployer(): Promise<
  { ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "unauthorized" };
  const access = await getProfileAccess(user.id);
  if (!access || access.status !== "active" || access.role !== "employer") {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, userId: user.id };
}

// For the talent directory (/talent, GET /api/talent): an active employer or an active admin.
export async function requireTalentViewer(): Promise<
  { ok: true; userId: string; role: "employer" | "admin" } | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: "unauthorized" };
  const access = await getProfileAccess(user.id);
  if (!access || access.status !== "active" || (access.role !== "employer" && access.role !== "admin")) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, userId: user.id, role: access.role };
}

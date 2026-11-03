import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth";

// Server-side access check for /admin pages. Only an active admin gets the page; everyone else is sent away.
// The proxy does the same check first; this one is authoritative.
export async function checkAdminPage(): Promise<{ adminId: string }> {
  const auth = await requireAdmin();
  if (auth.ok) return { adminId: auth.userId };
  redirect(auth.status === 401 ? "/login" : "/dashboard");
}

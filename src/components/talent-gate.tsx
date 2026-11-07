import { redirect } from "next/navigation";

import { requireTalentViewer } from "@/lib/auth";

// Server-side access check for /talent pages: an active employer or admin. Everyone else is sent away.
// The proxy does the same check first; this one is authoritative.
export async function checkTalentPage(): Promise<{ userId: string; role: "employer" | "admin" }> {
  const auth = await requireTalentViewer();
  if (auth.ok) return { userId: auth.userId, role: auth.role };
  redirect(auth.status === 401 ? "/login" : "/dashboard");
}

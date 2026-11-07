import "server-only";

import { cache } from "react";

import { getCurrentUser } from "@/lib/auth";
import { countPendingContactRequests, getProfileAccess, getProfileSummary } from "@/lib/db";
import type { Role } from "@/lib/validation";

export type ShellViewer =
  | { kind: "guest" }
  | { kind: "no-profile" }
  | { kind: "member"; id: string; name: string; role: Role; active: boolean };

// Who is looking at the page, for the navigation only. Pages and API routes check access themselves.
// cache(): the pill links, the mobile menu sheet and the account menu share one lookup per request.
export const getShellViewer = cache(async (): Promise<ShellViewer> => {
  const user = await getCurrentUser();
  if (!user) return { kind: "guest" };
  try {
    const [access, profile] = await Promise.all([getProfileAccess(user.id), getProfileSummary(user.id)]);
    if (!access || !profile) return { kind: "no-profile" };
    return { kind: "member", id: user.id, name: profile.full_name, role: access.role, active: access.status === "active" };
  } catch (error) {
    console.error("shell viewer lookup failed", error);
    return { kind: "no-profile" };
  }
});

// New (pending) contact requests of a student, for the nav badge. 0 on any error: /offers shows the list.
export const getPendingRequestCount = cache(async (studentId: string): Promise<number> => {
  try {
    return await countPendingContactRequests(studentId);
  } catch (error) {
    console.error("pending request count failed", error);
    return 0;
  }
});

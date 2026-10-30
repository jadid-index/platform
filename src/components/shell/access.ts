import "server-only";

import { cache } from "react";

import { getCurrentUser } from "@/lib/auth";
import { getProfileAccess, getProfileSummary } from "@/lib/db";

export type ShellViewer =
  | { kind: "guest" }
  | { kind: "no-profile" }
  | { kind: "member"; name: string; role: "student" | "reviewer" | "admin"; active: boolean };

// Who is looking at the page, for the navigation only. Pages and API routes check access themselves.
// cache(): the sidebar, the mobile drawer and the account menu share one lookup per request.
export const getShellViewer = cache(async (): Promise<ShellViewer> => {
  const user = await getCurrentUser();
  if (!user) return { kind: "guest" };
  try {
    const [access, profile] = await Promise.all([getProfileAccess(user.id), getProfileSummary(user.id)]);
    if (!access || !profile) return { kind: "no-profile" };
    return { kind: "member", name: profile.full_name, role: access.role, active: access.status === "active" };
  } catch (error) {
    console.error("shell viewer lookup failed", error);
    return { kind: "no-profile" };
  }
});

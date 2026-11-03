import "server-only";

import { createHash, createHmac } from "node:crypto";

import { getCurrentUser } from "@/lib/auth";
import { getProfileAccess, isVerifiedEmployer } from "@/lib/db";
import type { FileViewer } from "@/lib/file-access";

// The signed-in viewer for file access decisions, or anonymous.
export async function getFileViewer(): Promise<FileViewer> {
  const user = await getCurrentUser();
  if (!user) return { kind: "anonymous" };
  const access = await getProfileAccess(user.id);
  const verifiedEmployer = access?.role === "employer" ? await isVerifiedEmployer(user.id) : false;
  return {
    kind: "user",
    id: user.id,
    role: access?.role ?? null,
    active: access?.status === "active",
    verifiedEmployer,
  };
}

// Rate-limit key: the user id when signed in, otherwise an HMAC of the client IP (the raw IP is never stored).
// The key is derived from the server secret, like the upload tickets in src/lib/submissions.ts.
export function fileClientKey(viewer: FileViewer, headers: Headers): string {
  if (viewer.kind === "user") return `user:${viewer.id}`;
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY must be set");
  const key = createHash("sha256").update(`jadid-file-ip:${secret}`).digest();
  return `ip:${createHmac("sha256", key).update(ip).digest("base64url")}`;
}

import { apiError } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";

// AI extraction (SPEC section 4). PLACEHOLDER: owned by the backend engineer, not implemented yet.
// The model call has a ~20 s timeout, so allow 30 s in total. Vercel's limit with Fluid compute
// (on by default) is 300 s on every plan, so 30 s fits Hobby and Pro alike.
// Works on the stored proof ({ submission_id, path }), never on an uploaded body: Vercel rejects
// request bodies over 4.5 MB. Send only the document and the prompt, never profile data (rule 9).
export const maxDuration = 30;

export async function POST() {
  const auth = await requireActiveStudent();
  if (!auth.ok) return apiError(auth.status, auth.error);
  return apiError(501, "not_implemented");
}

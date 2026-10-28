import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { extractForStudent } from "@/lib/extraction";
import { extractBodySchema } from "@/lib/validation";

// AI extraction (SPEC section 4). Works on the proof already in the private bucket ({ submission_id, path }),
// never on an uploaded body: Vercel rejects request bodies over 4.5 MB. The model call has a 20 s timeout, so
// allow 30 s in total. Sends only the document and the prompt, never profile data (CLAUDE.md rule 9).
export const maxDuration = 30;

export async function POST(request: Request) {
  const parsed = extractBodySchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError(400, "invalid_body");

  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const res = await extractForStudent(auth.userId, parsed.data);
    if (!res.ok) return apiError(res.status, res.code);
    return NextResponse.json({ result: res.result, extraction_token: res.extraction_token });
  } catch (error) {
    console.error("extract failed", error instanceof Error ? error.name : "unknown");
    return apiError(500, "server_error");
  }
}

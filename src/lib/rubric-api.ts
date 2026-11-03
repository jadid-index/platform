import "server-only";

import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import type { RubricOutcome } from "@/lib/db";

export const NO_STORE = { "Cache-Control": "private, no-store" };

// Response for the rubric route handlers. Known SQL exceptions become stable codes; anything else is logged
// with the raw message and the client only gets a generic error.
export function rubricResponse<T>(outcome: RubricOutcome<T>, what: string, body: (data: T) => unknown) {
  if (outcome.ok) return NextResponse.json(body(outcome.data), { headers: NO_STORE });
  if (outcome.code === "sql_error") {
    console.error(`${what} failed with unknown SQL error:`, outcome.message);
    return apiError(500, "server_error");
  }
  return apiError(outcome.status, outcome.code);
}

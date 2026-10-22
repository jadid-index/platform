import "server-only";

import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import type { ApproveOutcome, ReviewOutcome } from "@/lib/db";
import { reviewErrorFromSql } from "@/lib/validation";

const STATUS: Record<string, number> = {
  not_found: 404,
  not_pending: 409,
  forbidden: 403,
  self_review: 403,
  invalid_combination: 400,
  date_too_early: 400,
  reason_required: 400,
};

// Response for the approve / reject route handlers. Known SQL exceptions become stable codes;
// anything else is logged here with the raw message and the client only gets a generic error.
export function reviewResponse(outcome: ReviewOutcome | ApproveOutcome, status: "approved" | "rejected") {
  if (outcome.ok) {
    // For approvals, include the points from the reviews row returned by approve_submission().
    const points =
      "points_awarded" in outcome
        ? { rubric_points: outcome.rubric_points, points_awarded: outcome.points_awarded }
        : {};
    return NextResponse.json({ status, ...points });
  }
  const { code, date } = reviewErrorFromSql(outcome.message);
  if (code === "sql_error") {
    console.error(`${status === "approved" ? "approve" : "reject"} failed with unknown SQL error:`, outcome.message);
    return apiError(500, "server_error");
  }
  return date ? NextResponse.json({ error: code, date }, { status: STATUS[code] }) : apiError(STATUS[code], code);
}

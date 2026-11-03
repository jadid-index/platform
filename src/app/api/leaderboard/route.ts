import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getDefaultLeaderboard, getLeaderboard } from "@/lib/db";
import { leaderboardQuerySchema } from "@/lib/validation";

// Public. Query: university_id, faculty_id, academic_year (start year or "all"), limit, offset.
// Default is the current academic year; while it has no entries, the most recent year with data
// (fallback_from_year is then set). Rows carry a tier, never points or a rank (CLAUDE.md rule 11),
// ordered by tier (best first) and then by name. No CDN caching: the server-side
// cache is purged on approval, a CDN copy would not be.
export async function GET(request: Request) {
  const query = leaderboardQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return apiError(400, "invalid_query");
  const { limit, offset, academic_year, ...filters } = query.data;

  try {
    const board =
      academic_year === undefined ? await getDefaultLeaderboard(filters) : await getLeaderboard({ ...filters, year: academic_year });
    return NextResponse.json({
        academic_year: board.academic_year,
        current_academic_year: board.current_academic_year,
        fallback_from_year: board.fallback_from_year,
        available_years: board.available_years,
        total: board.rows.length,
        limit,
        offset,
        rows: board.rows.slice(offset, offset + limit),
    });
  } catch (error) {
    console.error("leaderboard failed", error);
    return apiError(500, "server_error");
  }
}

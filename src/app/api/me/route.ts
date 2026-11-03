import { connection, NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import {
  getCategoryProgress,
  getCurrentAcademicYear,
  getOwnStanding,
  getProfileAccess,
  getProfileSummary,
  getStudentYears,
} from "@/lib/db";

const yearQuery = z.coerce.number().int().min(2000).max(2100).optional();

// The signed-in user's own profile. For a student also their exact points, tier and per-category points toward
// the yearly cap, for one academic year (?academic_year, default the current one) and all-time (best year).
// Only the owner gets these numbers; there is no rank.
export async function GET(request: Request) {
  await connection();
  const year = yearQuery.safeParse(new URL(request.url).searchParams.get("academic_year") ?? undefined);
  if (!year.success) return apiError(400, "invalid_query");

  try {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthorized");
    const [access, profile] = await Promise.all([getProfileAccess(user.id), getProfileSummary(user.id)]);
    if (!access || !profile) return apiError(404, "no_profile");

    const base = {
      id: profile.id,
      full_name: profile.full_name,
      role: access.role,
      status: access.status,
      university: profile.university || null,
      faculty: profile.faculty,
      course: profile.course,
    };
    const headers = { "Cache-Control": "private, no-store" };
    if (access.role !== "student") return NextResponse.json(base, { headers });

    const current = await getCurrentAcademicYear();
    const academicYear = year.data ?? current;
    const [standing, allTime, categories, years] = await Promise.all([
      getOwnStanding(user.id, academicYear),
      getOwnStanding(user.id, "all"),
      getCategoryProgress(user.id, academicYear),
      getStudentYears(user.id),
    ]);
    return NextResponse.json(
      {
        ...base,
        current_academic_year: current,
        academic_years: [...new Set([current, ...years])].sort((a, b) => b - a),
        year: { academic_year: academicYear, points: standing.points, tier: standing.tier, categories },
        all_time: { best_academic_year: allTime.academic_year, points: allTime.points, tier: allTime.tier },
      },
      { headers },
    );
  } catch (error) {
    console.error("me failed", error);
    return apiError(500, "server_error");
  }
}

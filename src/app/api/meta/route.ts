import { NextResponse } from "next/server";
import { connection } from "next/server";

import { apiError } from "@/lib/api";
import { getMeta } from "@/lib/db";

// Reference data for the dropdowns: universities with faculties, achievement types, rubric rows.
export async function GET() {
  await connection();
  try {
    return NextResponse.json(await getMeta());
  } catch (error) {
    console.error("meta failed", error);
    return apiError(500, "server_error");
  }
}

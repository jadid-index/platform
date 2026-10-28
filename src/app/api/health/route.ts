import { NextResponse, connection } from "next/server";

import { getCountFrom } from "@/lib/db";

// Liveness and database check for uptime monitors. Returns no configuration or error details.
export async function GET() {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  try {
    await getCountFrom();
    return NextResponse.json({ status: "ok", db: "ok" }, { headers });
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json({ status: "error", db: "error" }, { status: 503, headers });
  }
}

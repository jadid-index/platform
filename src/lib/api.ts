import { NextResponse } from "next/server";

// Error responses carry a stable code; the client maps it to a translated message.
export function apiError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

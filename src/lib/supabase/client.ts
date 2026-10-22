"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client. Use it for auth only (sign up, sign in, sign out).
// Never use it to read or write tables: data goes through the server API.
export function createAuthClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

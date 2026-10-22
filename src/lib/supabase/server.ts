import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Session-aware client for server components and route handlers. It uses the publishable key and the
// user's auth cookies, so it is only used to find out who the user is, never for database writes.
export async function createSessionClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a server component, where cookies are read-only. The proxy refreshes the session.
          }
        },
      },
    },
  );
}

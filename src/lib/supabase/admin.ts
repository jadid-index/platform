import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client with the secret key. It bypasses RLS, so it must never reach the browser.
// Only src/lib/db.ts should import it; everything else goes through that module.
let adminClient: SupabaseClient | undefined;

export function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    }
    adminClient = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return adminClient;
}

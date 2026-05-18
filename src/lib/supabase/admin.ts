import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";

import type { Database } from "./types";

/**
 * Service-role Supabase client. Bypasses RLS — only call from server actions
 * or route handlers, never from client/Server Components that surface data.
 *
 * Use cases that need this:
 *   - resolving auth.users (`admin.listUsers`, `admin.getUserById`)
 *   - sending invitation emails (`admin.inviteUserByEmail`, `generateLink`)
 *   - writing rows the user couldn't write via RLS (e.g. invitation redeem)
 */
export function createAdminClient() {
  const env = getServerEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

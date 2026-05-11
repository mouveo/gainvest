import { createBrowserClient } from "@supabase/ssr";

import { getEnv } from "@/lib/env";

import type { Database } from "./types";

export function createClient() {
  const env = getEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

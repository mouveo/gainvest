// Lazy access to public env vars. Throws on first use with a clear message
// if a required variable is missing, instead of crashing at module load.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. Copy .env.local.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function getEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env["NEXT_PUBLIC_SUPABASE_URL"] && process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  );
}

/**
 * Server-only env. Kept separate from `getEnv()` so we never accidentally
 * import the service-role key into a client bundle — the public env helper
 * stays usable in Server Components / middleware without pulling secrets
 * into its return shape.
 */
export function getServerEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function hasSupabaseAdminEnv(): boolean {
  return Boolean(
    process.env["NEXT_PUBLIC_SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"],
  );
}

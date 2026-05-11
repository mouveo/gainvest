import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseEnv } from "@/lib/env";
import { refreshSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Skip auth refresh until Supabase env vars are wired — keeps `pnpm dev` usable
  // before .env.local is filled in.
  if (!hasSupabaseEnv()) return NextResponse.next();
  return refreshSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

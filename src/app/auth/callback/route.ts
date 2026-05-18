import { NextResponse, type NextRequest } from "next/server";

import { ACTIVE_ACCOUNT_COOKIE } from "@/features/accounts/constants";
import { materializeInvitations } from "@/features/sharing/actions";
import { createClient } from "@/lib/supabase/server";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/portfolio";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // Redeem any open invitations for this email and, when at least one new
  // account was joined, park its id in the active-account cookie so the
  // user lands directly on the shared account rather than their default.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const response = NextResponse.redirect(`${origin}${next}`);

  if (user?.id && user.email) {
    const joinedAccountId = await materializeInvitations(user.id, user.email);
    if (joinedAccountId) {
      response.cookies.set(ACTIVE_ACCOUNT_COOKIE, joinedAccountId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: ONE_YEAR_SECONDS,
        secure: process.env.NODE_ENV === "production",
      });
    }
  }

  return response;
}

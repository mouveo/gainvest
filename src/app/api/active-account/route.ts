import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { ACTIVE_ACCOUNT_COOKIE, ALL_ACCOUNTS } from "@/features/accounts/constants";
import { isUuid } from "@/features/accounts/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(request: NextRequest) {
  let payload: { accountId?: unknown } = {};
  try {
    payload = (await request.json()) as { accountId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalide." }, { status: 400 });
  }

  const raw = payload.accountId;
  if (typeof raw !== "string" || raw.length === 0) {
    return NextResponse.json({ ok: false, error: "accountId requis." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Non authentifié." }, { status: 401 });
  }

  let cookieValue: string;

  if (raw === ALL_ACCOUNTS) {
    cookieValue = ALL_ACCOUNTS;
  } else if (isUuid(raw)) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", raw)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Compte introuvable ou non accessible." },
        { status: 404 },
      );
    }
    cookieValue = data.id;
  } else {
    return NextResponse.json(
      { ok: false, error: "accountId invalide." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ACCOUNT_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });

  revalidatePath("/");
  revalidatePath("/portfolio");

  return NextResponse.json({ ok: true });
}

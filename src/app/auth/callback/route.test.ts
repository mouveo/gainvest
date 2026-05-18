import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/features/sharing/actions", () => ({
  materializeInvitations: vi.fn(),
}));

import { materializeInvitations } from "@/features/sharing/actions";
import { createClient } from "@/lib/supabase/server";

import { GET } from "./route";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const ACC_PERSO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeRequest(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

function supabaseStub(opts: {
  exchangeError?: { message: string } | null;
  user?: { id: string; email: string | null } | null;
}) {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ error: opts.exchangeError ?? null })),
      getUser: vi.fn(async () => ({ data: { user: opts.user ?? null } })),
    },
  };
}

const createClientMock = vi.mocked(createClient);
const materializeMock = vi.mocked(materializeInvitations);

beforeEach(() => {
  createClientMock.mockReset();
  materializeMock.mockReset();
});

describe("GET /auth/callback", () => {
  it("redirects to /login when no code is provided", async () => {
    const sb = supabaseStub({ user: { id: USER_ID, email: "alice@example.com" } });
    createClientMock.mockResolvedValue(sb as never);

    const res = await GET(makeRequest("http://localhost:3000/auth/callback"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects to /login on exchange error", async () => {
    const sb = supabaseStub({
      exchangeError: { message: "bad code" },
      user: null,
    });
    createClientMock.mockResolvedValue(sb as never);

    const res = await GET(
      makeRequest("http://localhost:3000/auth/callback?code=bad"),
    );
    expect(res.headers.get("location")).toContain("/login?error=auth_failed");
  });

  it("redirects to next without setting the cookie when no invitation is consumed", async () => {
    const sb = supabaseStub({
      user: { id: USER_ID, email: "alice@example.com" },
    });
    createClientMock.mockResolvedValue(sb as never);
    materializeMock.mockResolvedValue(null);

    const res = await GET(
      makeRequest("http://localhost:3000/auth/callback?code=ok"),
    );
    expect(res.headers.get("location")).toBe("http://localhost:3000/portfolio");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie ?? "").not.toContain("gainvest_active_account");
  });

  it("sets gainvest_active_account when an invitation is consumed", async () => {
    const sb = supabaseStub({
      user: { id: USER_ID, email: "alice@example.com" },
    });
    createClientMock.mockResolvedValue(sb as never);
    materializeMock.mockResolvedValue(ACC_PERSO);

    const res = await GET(
      makeRequest("http://localhost:3000/auth/callback?code=ok"),
    );
    expect(res.headers.get("location")).toBe("http://localhost:3000/portfolio");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("gainvest_active_account=");
    expect(cookie).toContain(ACC_PERSO);
  });

  it("honours the next query param", async () => {
    const sb = supabaseStub({
      user: { id: USER_ID, email: "alice@example.com" },
    });
    createClientMock.mockResolvedValue(sb as never);
    materializeMock.mockResolvedValue(null);

    const res = await GET(
      makeRequest("http://localhost:3000/auth/callback?code=ok&next=/settings"),
    );
    expect(res.headers.get("location")).toBe("http://localhost:3000/settings");
  });

  it("skips materialization when no user is returned", async () => {
    const sb = supabaseStub({ user: null });
    createClientMock.mockResolvedValue(sb as never);

    const res = await GET(
      makeRequest("http://localhost:3000/auth/callback?code=ok"),
    );
    expect(res.headers.get("location")).toBe("http://localhost:3000/portfolio");
    expect(materializeMock).not.toHaveBeenCalled();
  });

  it("skips materialization when the user has no email", async () => {
    const sb = supabaseStub({ user: { id: USER_ID, email: null } });
    createClientMock.mockResolvedValue(sb as never);

    const res = await GET(
      makeRequest("http://localhost:3000/auth/callback?code=ok"),
    );
    expect(res.headers.get("location")).toBe("http://localhost:3000/portfolio");
    expect(materializeMock).not.toHaveBeenCalled();
  });
});

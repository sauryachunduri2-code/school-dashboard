import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const exchange = vi.fn();
const jar = { get: vi.fn(), delete: vi.fn() };

vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { exchangeCodeForSession: exchange, signOut: vi.fn() } }),
  supabaseAdmin: () => ({ from: () => ({ upsert }) }),
}));

const call = async (qs: string) => {
  const { GET } = await import("@/app/auth/callback/route");
  return GET(new Request(`https://daybook.example/auth/callback?${qs}`));
};
const session = (refresh: string | null) => ({
  data: { session: { user: { email: "sauryachunduri2@gmail.com" }, provider_refresh_token: refresh } },
  error: null,
});

describe("auth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jar.get.mockReturnValue(undefined);
  });

  it("logs a failed refresh-token store (supabase-js returns { error }, it doesn't throw)", async () => {
    exchange.mockResolvedValue(session("refresh-token"));
    upsert.mockResolvedValue({ error: { message: "permission denied" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call("code=abc&next=/settings");
    expect(spy).toHaveBeenCalledWith("could not store google refresh token", "permission denied");
    expect(res.headers.get("location")).toBe("https://daybook.example/settings");
    spy.mockRestore();
  });

  it("stays quiet when the store works", async () => {
    exchange.mockResolvedValue(session("refresh-token"));
    upsert.mockResolvedValue({ error: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await call("code=abc");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com"])("never redirects off-site (%s)", async (next) => {
    exchange.mockResolvedValue(session(null));
    const res = await call(`code=abc&next=${encodeURIComponent(next)}`);
    expect(res.headers.get("location")).toBe("https://daybook.example/");
  });

  it("also checks the cookie-supplied next", async () => {
    exchange.mockResolvedValue(session(null));
    jar.get.mockReturnValue({ value: "/\\evil.com" });
    expect((await call("code=abc")).headers.get("location")).toBe("https://daybook.example/");
  });
});

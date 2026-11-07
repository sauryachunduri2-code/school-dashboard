import { NextResponse } from "next/server";
import { getOwner } from "../supabase/server";
import { getGoogleSession } from "./server";
import { GoogleApiError } from "./types";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Shared guard for /api/google/*: owner only, Google configured and connected. */
export async function withGoogle<T>(
  fn: (ctx: Extract<Awaited<ReturnType<typeof getGoogleSession>>, { status: "ready" }>) => Promise<T>,
): Promise<NextResponse> {
  const owner = await getOwner();
  if (!owner) return json({ error: "unauthorized" }, 401);
  try {
    const session = await getGoogleSession();
    if (session.status === "not-configured") return json({ error: "google-not-configured" }, 503);
    if (session.status === "not-connected") return json({ error: "google-not-connected" }, 409);
    return json(await fn(session));
  } catch (e) {
    if (e instanceof GoogleApiError) {
      console.error(`google api ${e.status}:`, e.message.slice(0, 500));
      // 401 from Google means the refresh token was revoked: ask the user to reconnect.
      const status = e.status === 401 ? 409 : e.status >= 400 && e.status < 600 ? e.status : 502;
      return json({ error: e.status === 401 ? "google-not-connected" : "google-error", detail: e.message.slice(0, 300) }, status);
    }
    console.error("google route failed", e instanceof Error ? e.message : e);
    return json({ error: "server-error" }, 500);
  }
}

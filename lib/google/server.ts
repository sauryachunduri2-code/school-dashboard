import { googleConfigured } from "../env";
import { supabaseAdmin } from "../supabase/server";
import type { CalendarRow } from "../types";
import { createGoogleClient, type GoogleClient } from "./client";
import { refreshAccessToken } from "./token";
import { createAccessTokenCache } from "./token-cache";

const tokenCache = createAccessTokenCache();

export type GoogleSession =
  | { status: "not-configured" }
  | { status: "not-connected" }
  | { status: "ready"; google: GoogleClient; tz: string };

/** Build a Calendar API client from the stored refresh token. Server only. */
export async function getGoogleSession(): Promise<GoogleSession> {
  if (!googleConfigured()) return { status: "not-configured" };
  const admin = supabaseAdmin();
  const { data } = await admin.from("google_account").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data?.refresh_token) return { status: "not-connected" };
  const refreshToken = data.refresh_token as string;
  const google = createGoogleClient(() =>
    tokenCache.get(refreshToken, () =>
      refreshAccessToken({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        refreshToken,
      }),
    ),
  );
  return { status: "ready", google, tz: process.env.APP_TIMEZONE ?? "America/New_York" };
}

export async function getCalendarRow(id: string): Promise<CalendarRow | null> {
  const { data } = await supabaseAdmin().from("calendars").select("*").eq("id", id).maybeSingle();
  return (data as CalendarRow | null) ?? null;
}

import { GoogleApiError, type FetchLike } from "./types";

export interface RefreshInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: FetchLike;
}

export interface AccessToken {
  accessToken: string;
  expiresAt: number;
}

/** Exchange the stored refresh token for a short-lived access token. */
export async function refreshAccessToken(input: RefreshInput, now = Date.now()): Promise<AccessToken> {
  const f = input.fetch ?? (fetch as FetchLike);
  const res = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new GoogleApiError(res.status === 400 ? 401 : res.status, json.error ?? "token refresh failed");
  }
  return { accessToken: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 - 60_000 };
}

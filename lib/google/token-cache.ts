import { createHash } from "node:crypto";
import type { AccessToken } from "./token";

/**
 * Access token cache for one server instance. The entry is tied to the refresh token it was minted from
 * (stored as a hash), so reconnecting Google (a new refresh token) never reuses the old account's token.
 */
export function createAccessTokenCache() {
  let entry: { key: string; token: string; expiresAt: number } | null = null;
  const keyOf = (refreshToken: string) => createHash("sha256").update(refreshToken).digest("hex");
  return {
    async get(refreshToken: string, refresh: () => Promise<AccessToken>, now = Date.now()): Promise<string> {
      const key = keyOf(refreshToken);
      if (entry && entry.key === key && entry.expiresAt > now) return entry.token;
      entry = null;
      const t = await refresh();
      entry = { key, token: t.accessToken, expiresAt: t.expiresAt };
      return t.accessToken;
    },
  };
}

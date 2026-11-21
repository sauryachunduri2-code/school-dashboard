import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { OWNER_EMAIL, SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "../env";

/**
 * Rise (the iPhone alarm app) signs in with Google through Supabase and calls with `Authorization: Bearer <access token>`.
 * Only the owner gets through, the same rule as the cookie sign-in. Returns a client scoped to that token, so RLS applies too.
 */
export async function bearerOwner(
  request: Request,
  make: (url: string, key: string, token: string) => SupabaseClient = scopedClient,
): Promise<{ email: string; db: SupabaseClient } | null> {
  if (!supabaseConfigured) return null;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const db = make(SUPABASE_URL, SUPABASE_ANON_KEY, token);
  const { data, error } = await db.auth.getClaims(token);
  const email = (data?.claims?.email as string | undefined)?.toLowerCase();
  if (error || !email || email !== OWNER_EMAIL.toLowerCase()) return null;
  return { email, db };
}

function scopedClient(url: string, key: string, token: string) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

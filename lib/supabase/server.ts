import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { OWNER_EMAIL, SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "../env";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component; the proxy refreshes the session instead
        }
      },
    },
  });
}

/** Service-role client. Server only; bypasses RLS. */
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Owner = { email: string };

/** Route-handler guard. Returns the owner, or null if the caller is not signed in as the allowed account. */
export async function getOwner(): Promise<Owner | null> {
  if (!supabaseConfigured) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims?.email as string | undefined)?.toLowerCase();
  return email && email === OWNER_EMAIL.toLowerCase() ? { email } : null;
}

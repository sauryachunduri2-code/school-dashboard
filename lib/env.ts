// NEXT_PUBLIC_* values are inlined at build time, so each must be referenced literally.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * DEV-ONLY fallback: when Supabase env vars are missing and we run `next dev`, the app
 * stores data in this browser's IndexedDB and skips sign-in. Never active in production builds.
 */
export const localMode = !supabaseConfigured && process.env.NODE_ENV === "development";

/**
 * The one account allowed in. NEXT_PUBLIC_ so the server (proxy, auth callback) and the client (login, settings)
 * read the same value. It MUST equal the email hard-coded in the is_owner() SQL function (supabase/migrations/0002),
 * which is what actually protects the data. Change both together, or the database will reject you.
 */
export const OWNER_EMAIL = process.env.NEXT_PUBLIC_ALLOWED_EMAIL ?? "sauryachunduri2@gmail.com";

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

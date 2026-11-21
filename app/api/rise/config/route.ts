import { NextResponse } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "@/lib/env";

/**
 * What Rise needs to start Google sign-in: the Supabase project URL and its public anon key (the same values every browser
 * that opens /login already gets), and the redirect Rise listens for. Nothing here is secret.
 */
export function GET() {
  if (!supabaseConfigured) return NextResponse.json({ error: "not-configured" }, { status: 503 });
  return NextResponse.json({ supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, redirect: "rise://auth-callback" });
}

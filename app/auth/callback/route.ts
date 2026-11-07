import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth";
import { OWNER_EMAIL } from "@/lib/env";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Set by the Settings "Connect" button; see app/(app)/settings/page.tsx.
  const jar = await cookies();
  const next = url.searchParams.get("next") ?? jar.get("auth_next")?.value ?? "/";
  jar.delete("auth_next");
  const safeNext = safeNextPath(next, url.origin);
  if (!code) return NextResponse.redirect(new URL("/login?error=missing-code", url.origin));

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) return NextResponse.redirect(new URL("/login?error=exchange", url.origin));

  const email = data.session.user.email?.toLowerCase();
  if (email !== OWNER_EMAIL.toLowerCase()) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=forbidden", url.origin));
  }

  // The Google refresh token only appears on the sign-in that granted offline access.
  // Keep it server-side; the client never sees it.
  const refresh = data.session.provider_refresh_token;
  if (refresh) {
    try {
      // supabase-js reports failures as { error } instead of throwing.
      const { error: storeError } = await supabaseAdmin().from("google_account").upsert({
        id: 1,
        email,
        refresh_token: refresh,
        scopes: url.searchParams.get("scope") ?? null,
        updated_at: new Date().toISOString(),
      });
      if (storeError) console.error("could not store google refresh token", storeError.message);
    } catch (e) {
      console.error("could not store google refresh token", e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}

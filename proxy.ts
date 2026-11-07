import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { OWNER_EMAIL, SUPABASE_ANON_KEY, SUPABASE_URL, localMode, supabaseConfigured } from "@/lib/env";

const PUBLIC_PREFIXES = ["/login", "/privacy","/auth/", "/api/cron/", "/sw.js", "/due-line.js", "/manifest.webmanifest", "/pwa-icon", "/favicon"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (localMode) return NextResponse.next(); // dev-only fallback, see lib/env.ts

  const isApi = pathname.startsWith("/api/");
  const deny = (reason: string) =>
    isApi
      ? NextResponse.json({ error: reason }, { status: 401 })
      : NextResponse.redirect(new URL(`/login${reason === "forbidden" ? "?error=forbidden" : ""}`, request.url));

  if (!supabaseConfigured) return deny("not-configured");

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Only the owner's Google account gets through; anyone else is bounced (RLS blocks them in the DB too).
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims?.email as string | undefined)?.toLowerCase();
  if (!email) return deny("unauthenticated");
  if (email !== OWNER_EMAIL.toLowerCase()) return deny("forbidden");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)"],
};

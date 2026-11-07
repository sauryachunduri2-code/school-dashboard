"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { OWNER_EMAIL, supabaseConfigured } from "@/lib/env";
import { supabaseBrowser } from "@/lib/supabase/browser";

const MESSAGES: Record<string, string> = {
  forbidden: `That Google account isn't allowed here. Sign in with ${OWNER_EMAIL}.`,
  exchange: "Sign-in didn't finish. Try again.",
  "missing-code": "Sign-in didn't finish. Try again.",
};

function LoginInner() {
  const params = useSearchParams();
  const error = params.get("error");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { login_hint: OWNER_EMAIL } },
    });
  }

  return (
    <main className="relative z-[1] mx-auto grid min-h-dvh max-w-md content-center gap-6 px-6">
      <div className="ruled px-8 py-10" style={{ ["--margin-x" as string]: "2.25rem" }}>
        <h1 className="display pl-6 text-5xl italic">Daybook</h1>
        <p className="mt-2 pl-6 text-ink2">School and extracurriculars, in one place.</p>
        <div className="mt-8 pl-6">
          {supabaseConfigured ? (
            <button className="btn btn-primary w-full justify-center" onClick={signIn} disabled={busy}>
              {busy ? "Opening Google…" : "Continue with Google"}
            </button>
          ) : (
            <p className="rounded border border-rulestrong bg-sheet2 p-3 text-sm text-ink2">
              Supabase isn&apos;t connected yet, so sign-in is switched off. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then reload.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-overdue">
              {MESSAGES[error] ?? "Something went wrong signing in."}
            </p>
          )}
          <p className="mt-6 text-xs text-ink3">Private to {OWNER_EMAIL}.</p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

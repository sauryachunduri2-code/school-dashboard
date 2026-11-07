import { NextResponse } from "next/server";
import { getOwner, supabaseAdmin } from "@/lib/supabase/server";

interface SubBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function POST(request: Request) {
  if (!(await getOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => null)) as SubBody | null;
  if (!b?.endpoint || !b.keys?.p256dh || !b.keys.auth) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  const { error } = await supabaseAdmin()
    .from("push_subscriptions")
    .upsert(
      { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, user_agent: request.headers.get("user-agent")?.slice(0, 200) },
      { onConflict: "endpoint" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await getOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await request.json().catch(() => null)) as SubBody | null;
  if (!b?.endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  await supabaseAdmin().from("push_subscriptions").delete().eq("endpoint", b.endpoint);
  return NextResponse.json({ ok: true });
}

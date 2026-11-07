import { NextResponse } from "next/server";
import { sendPush } from "@/lib/push";
import { getOwner, supabaseAdmin } from "@/lib/supabase/server";

export async function POST() {
  if (!(await getOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = supabaseAdmin();
  const { data } = await db.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (!data?.length) return NextResponse.json({ error: "no-subscriptions" }, { status: 409 });
  const res = await sendPush(data, { title: "Test reminder", listName: "School Dashboard", due_at: null, all_day: false, tag: "test", url: "/settings" });
  if (res.gone.length) await db.from("push_subscriptions").delete().in("endpoint", res.gone);
  return NextResponse.json(res);
}

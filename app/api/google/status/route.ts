import { googleConfigured } from "@/lib/env";
import { json } from "@/lib/google/route";
import { getOwner, supabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  if (!(await getOwner())) return json({ error: "unauthorized" }, 401);
  const configured = googleConfigured();
  let connected = false;
  if (configured) {
    const { data } = await supabaseAdmin().from("google_account").select("email").eq("id", 1).maybeSingle();
    connected = !!data;
  }
  return json({ configured, connected });
}

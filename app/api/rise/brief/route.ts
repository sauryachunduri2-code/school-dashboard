import { NextResponse } from "next/server";
import { bearerOwner } from "@/lib/brief/auth";
import { geminiWriter, makeBrief } from "@/lib/brief/brief";
import type { CalendarStatus } from "@/lib/brief/types";
import { addDaysYmd, isValidZone, zonedMidnight, zonedYmd } from "@/lib/brief/zone";
import { getGoogleSession } from "@/lib/google/server";
import type { CalendarRow, GEvent, List, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The morning brief for Rise. `?tz=America/New_York` (the phone's zone; defaults to APP_TIMEZONE) and optional `?date=YYYY-MM-DD`.
 * Auth is a Supabase access token from Rise's Google sign-in (see lib/brief/auth.ts), so this path skips the cookie proxy.
 */
export async function GET(request: Request) {
  const owner = await bearerOwner(request);
  if (!owner) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const tz = url.searchParams.get("tz") || process.env.APP_TIMEZONE || "America/New_York";
  if (!isValidZone(tz)) return json({ error: "bad tz" }, 400);
  const date = url.searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "bad date" }, 400);
  const now = new Date();
  const ymd = date ?? zonedYmd(now, tz);

  const [tasks, lists] = await Promise.all([
    owner.db.from("tasks").select("*").is("completed_at", null),
    owner.db.from("lists").select("*"),
  ]);
  if (tasks.error) {
    console.error("brief: tasks", tasks.error.message);
    return json({ error: "server-error" }, 502);
  }

  let calendar: CalendarStatus = "ok";
  let events: GEvent[] = [];
  try {
    const session = await getGoogleSession();
    if (session.status !== "ready") calendar = session.status;
    else {
      const { data: cals } = await owner.db.from("calendars").select("*").eq("enabled", true);
      const window = { timeMin: zonedMidnight(ymd, tz).toISOString(), timeMax: zonedMidnight(addDaysYmd(ymd, 8), tz).toISOString() };
      const results = await Promise.allSettled(((cals ?? []) as CalendarRow[]).map((c) => session.google.syncEvents(c, window)));
      events = results.flatMap((r) => (r.status === "fulfilled" ? r.value.events : []));
      const failed = results.filter((r) => r.status === "rejected");
      failed.forEach((r) => console.error("brief: calendar", (r as PromiseRejectedResult).reason?.message ?? r));
      if (failed.length && failed.length === results.length) calendar = "error";
    }
  } catch (e) {
    console.error("brief: google", e instanceof Error ? e.message : e);
    calendar = "error";
  }

  const brief = await makeBrief({
    tasks: (tasks.data ?? []) as Task[],
    lists: (lists.data ?? []) as List[],
    events,
    now,
    tz,
    date: ymd,
    calendar,
    writer: geminiWriter(),
    log: (m) => console.error(m),
  });
  return json(brief);
}

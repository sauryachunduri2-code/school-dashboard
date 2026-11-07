import { withGoogle } from "@/lib/google/route";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { CalendarRow } from "@/lib/types";

/** Pull the calendar list from Google and upsert rows, keeping the user's enabled/default choices. */
export async function POST() {
  return withGoogle(async ({ google }) => {
    const remote = await google.listCalendars();
    const admin = supabaseAdmin();
    const { data: existing } = await admin.from("calendars").select("*");
    const byId = new Map((existing as CalendarRow[] | null)?.map((c) => [c.id, c]) ?? []);
    const firstRun = byId.size === 0;
    const rows: CalendarRow[] = remote.map((c) => {
      const prev = byId.get(c.id);
      const readOnly = c.accessRole === "reader" || c.accessRole === "freeBusyReader";
      return {
        id: c.id,
        summary: c.summaryOverride ?? c.summary,
        color: c.backgroundColor ?? "#6b6760",
        read_only: readOnly,
        enabled: prev?.enabled ?? (firstRun && !!c.primary),
        is_default: prev?.is_default ?? (firstRun && !!c.primary),
      };
    });
    if (rows.length) {
      const { error } = await admin.from("calendars").upsert(rows);
      if (error) throw new Error(error.message);
    }
    // calendars removed from the Google account
    const gone = [...byId.keys()].filter((id) => !rows.some((r) => r.id === id));
    if (gone.length) await admin.from("calendars").delete().in("id", gone);
    return { calendars: rows };
  });
}

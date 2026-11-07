import { withGoogle, json } from "@/lib/google/route";
import { GoogleApiError } from "@/lib/google/types";
import { getCalendarRow } from "@/lib/google/server";

const DAY = 86400000;

/** Returns only what changed since `syncToken` (or the full window when there is no token / it expired). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { calendarId?: string; syncToken?: string | null };
  if (!body.calendarId) return json({ error: "calendarId required" }, 400);
  return withGoogle(async ({ google }) => {
    const cal = await getCalendarRow(body.calendarId!);
    if (!cal || !cal.enabled) throw new GoogleApiError(400, "calendar not enabled");
    const now = Date.now();
    return google.syncEvents(cal, {
      syncToken: body.syncToken,
      timeMin: new Date(now - 60 * DAY).toISOString(),
      timeMax: new Date(now + 400 * DAY).toISOString(),
    });
  });
}

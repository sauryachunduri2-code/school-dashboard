import type { EventPatch } from "@/lib/google/mapping";
import { shiftSeries } from "@/lib/google/merge";
import { fromGoogle, splitTodo } from "@/lib/google/mapping";
import { json, withGoogle } from "@/lib/google/route";
import { GoogleApiError } from "@/lib/google/types";
import { getCalendarRow } from "@/lib/google/server";

interface WriteBody {
  calendarId: string;
  eventId?: string;
  patch?: EventPatch;
  etag?: string | null;
  tz?: string;
  /** For recurring instances: edit just this one or the whole series (the master event). */
  scope?: "this" | "all";
  recurringEventId?: string | null;
  /** Needed to shift a whole series when a dragged instance moves in time */
  instanceBefore?: { start: string; end: string };
}

async function calendarOr400(id: string) {
  const cal = await getCalendarRow(id);
  if (!cal || !cal.enabled) throw new GoogleApiError(400, "calendar not enabled");
  if (cal.read_only) throw new GoogleApiError(403, "calendar is read-only");
  return cal;
}

export async function POST(request: Request) {
  const b = (await request.json().catch(() => null)) as WriteBody | null;
  if (!b?.calendarId || !b.patch) return json({ error: "calendarId and patch required" }, 400);
  return withGoogle(async ({ google, tz }) => {
    const cal = await calendarOr400(b.calendarId);
    return { event: await google.insertEvent(cal, b.patch!, b.tz ?? tz) };
  });
}

export async function PATCH(request: Request) {
  const b = (await request.json().catch(() => null)) as WriteBody | null;
  if (!b?.calendarId || !b.eventId || !b.patch) return json({ error: "calendarId, eventId and patch required" }, 400);
  return withGoogle(async ({ google, tz }) => {
    const cal = await calendarOr400(b.calendarId);
    const zone = b.tz ?? tz;
    let patch: EventPatch = b.patch!;
    if (b.recurringEventId && patch.todo !== undefined) {
      // The to-do flag of a recurring event always lives on the series master, so every occurrence changes together
      // and there is no this/all choice for it. Everything else in the patch is applied to the instance or series as usual.
      const { todo, rest } = splitTodo(patch);
      const masterNow = await google.getEvent(cal.id, b.recurringEventId);
      const res = await google.patchEvent(cal, b.recurringEventId, { todo }, masterNow.etag, zone);
      if (!res.ok) return res;
      if (Object.keys(rest).length === 0) {
        return { ok: true as const, event: fromGoogle(await google.getEvent(cal.id, b.eventId!), cal) };
      }
      patch = rest;
    }
    if (b.scope === "all" && b.recurringEventId) {
      // Edit the master. It has its own etag, so fetch it fresh; time moves are applied as a shift.
      const masterRaw = await google.getEvent(cal.id, b.recurringEventId);
      const master = fromGoogle(masterRaw, cal);
      patch = { ...patch };
      if (patch.start && patch.end && b.instanceBefore) {
        const shifted = shiftSeries(master, b.instanceBefore, { start: patch.start, end: patch.end });
        patch.start = shifted.start;
        patch.end = shifted.end;
        patch.all_day = master.all_day;
      } else {
        delete patch.start;
        delete patch.end;
      }
      return google.patchEvent(cal, b.recurringEventId, patch, master.etag, zone);
    }
    return google.patchEvent(cal, b.eventId!, patch, b.etag ?? null, zone);
  });
}

export async function DELETE(request: Request) {
  const b = (await request.json().catch(() => null)) as WriteBody | null;
  if (!b?.calendarId || !b.eventId) return json({ error: "calendarId and eventId required" }, 400);
  return withGoogle(async ({ google }) => {
    const cal = await calendarOr400(b.calendarId);
    const target = b.scope === "all" && b.recurringEventId ? b.recurringEventId : b.eventId!;
    return google.deleteEvent(cal, target, b.scope === "all" ? null : (b.etag ?? null));
  });
}

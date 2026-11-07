import type { QueryClient } from "@tanstack/react-query";
import { ymd } from "./dates";
import type { GEvent } from "./types";

/** "I did this event today": one row per (calendar, series or event, day). Lives in the dashboard only; Google isn't touched. */
export interface EventCheck {
  calendar_id: string;
  /** The series id for an occurrence of a recurring event, otherwise the event id. */
  event_key: string;
  /** YYYY-MM-DD, local date */
  day: string;
  checked_at: string;
}

export const eventKey = (e: Pick<GEvent, "id" | "recurring_event_id">) => e.recurring_event_id ?? e.id;

export const checkId = (calendarId: string, key: string, day: string) => `${calendarId}|${key}|${day}`;
export const checkIdOf = (c: Pick<EventCheck, "calendar_id" | "event_key" | "day">) => checkId(c.calendar_id, c.event_key, c.day);

export const checkIdFor = (e: Pick<GEvent, "id" | "calendar_id" | "recurring_event_id">, day: Date) => checkId(e.calendar_id, eventKey(e), ymd(day));

/** Fast lookup of which (event, day) pairs are checked. */
export const checkSet = (checks: EventCheck[] | undefined): Set<string> => new Set((checks ?? []).map(checkIdOf));

export const isEventChecked = (set: Set<string>, e: Pick<GEvent, "id" | "calendar_id" | "recurring_event_id">, day: Date) => set.has(checkIdFor(e, day));

/** The list with `c` added (replacing the same check if it is already there). */
export const withCheck = (list: EventCheck[], c: EventCheck): EventCheck[] => [...withoutCheck(list, checkIdOf(c)), c];

export const withoutCheck = (list: EventCheck[], id: string): EventCheck[] => list.filter((c) => checkIdOf(c) !== id);

export const EVENT_CHECKS_KEY = ["event_checks"] as const;

export interface CheckStore {
  put(check: EventCheck): Promise<void>;
  del(check: Pick<EventCheck, "calendar_id" | "event_key" | "day">): Promise<void>;
}

/**
 * Check or uncheck an event for one day. The cache changes first (so the ring and list react at once) and is rolled back
 * if saving fails, in which case it resolves false.
 */
export async function toggleEventCheck(
  qc: QueryClient,
  store: CheckStore,
  event: Pick<GEvent, "id" | "calendar_id" | "recurring_event_id">,
  day: Date,
  onError: (message: string) => void,
  now = new Date(),
): Promise<boolean> {
  await qc.cancelQueries({ queryKey: EVENT_CHECKS_KEY });
  const prev = qc.getQueryData<EventCheck[]>(EVENT_CHECKS_KEY) ?? [];
  const id = checkIdFor(event, day);
  const existing = prev.find((c) => checkIdOf(c) === id);
  const row: EventCheck = existing ?? { calendar_id: event.calendar_id, event_key: eventKey(event), day: ymd(day), checked_at: now.toISOString() };
  qc.setQueryData<EventCheck[]>(EVENT_CHECKS_KEY, existing ? withoutCheck(prev, id) : withCheck(prev, row));
  try {
    if (existing) await store.del(row);
    else await store.put(row);
    return true;
  } catch (e) {
    qc.setQueryData(EVENT_CHECKS_KEY, prev);
    onError(`Couldn't save: ${e instanceof Error ? e.message : "network error"}`);
    return false;
  }
}

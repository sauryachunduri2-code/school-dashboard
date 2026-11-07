import type { GEvent } from "../types";
import type { SyncDelta } from "./client";

/** Per-calendar slice of the persisted client cache. */
export interface CalendarCache {
  syncToken: string | null;
  events: Record<string, GEvent>;
}

export type EventsCache = Record<string, CalendarCache>;

export const emptyCalendarCache = (): CalendarCache => ({ syncToken: null, events: {} });

/** Apply a server delta to the cached events of one calendar. Pure. */
export function mergeDelta(cache: EventsCache | undefined, delta: SyncDelta): EventsCache {
  const prev = cache ?? {};
  const base = delta.fullResync ? emptyCalendarCache() : (prev[delta.calendarId] ?? emptyCalendarCache());
  const events = { ...base.events };
  for (const id of delta.deleted) delete events[id];
  for (const e of delta.events) events[e.id] = e;
  return { ...prev, [delta.calendarId]: { syncToken: delta.nextSyncToken ?? base.syncToken, events } };
}

/** Replace one event (e.g. after a write or an etag conflict). */
export function putEvent(cache: EventsCache | undefined, e: GEvent): EventsCache {
  const prev = cache ?? {};
  const cal = prev[e.calendar_id] ?? emptyCalendarCache();
  return { ...prev, [e.calendar_id]: { ...cal, events: { ...cal.events, [e.id]: e } } };
}

export function removeEvent(cache: EventsCache | undefined, calendarId: string, id: string): EventsCache {
  const prev = cache ?? {};
  const cal = prev[calendarId];
  if (!cal) return prev;
  const events = { ...cal.events };
  delete events[id];
  return { ...prev, [calendarId]: { ...cal, events } };
}

/** Set the to-do flag on every cached occurrence of a recurring event (the flag itself is stored on the series master). */
export function setSeriesTodo(cache: EventsCache | undefined, calendarId: string, recurringEventId: string, todo: boolean): EventsCache {
  const prev = cache ?? {};
  const cal = prev[calendarId];
  if (!cal) return prev;
  const events = Object.fromEntries(Object.entries(cal.events).map(([id, e]) => [id, e.recurring_event_id === recurringEventId ? { ...e, todo } : e]));
  return { ...prev, [calendarId]: { ...cal, events } };
}

/** Drop calendars the user disabled so their events disappear from the UI. */
export function pruneCalendars(cache: EventsCache | undefined, enabledIds: string[]): EventsCache {
  const keep = new Set(enabledIds);
  return Object.fromEntries(Object.entries(cache ?? {}).filter(([id]) => keep.has(id)));
}

export function allEvents(cache: EventsCache | undefined): GEvent[] {
  return Object.values(cache ?? {}).flatMap((c) => Object.values(c.events));
}

/** For "all events in the series": shift a master's start/end by how far the dragged instance moved. */
export function shiftSeries(
  master: { start: string; end: string; all_day: boolean },
  instanceOld: { start: string; end: string },
  instanceNew: { start: string; end: string },
): { start: string; end: string } {
  if (master.all_day) {
    const dayMs = 86400000;
    const dStart = Math.round((Date.parse(instanceNew.start.slice(0, 10)) - Date.parse(instanceOld.start.slice(0, 10))) / dayMs);
    const dEnd = Math.round((Date.parse(instanceNew.end.slice(0, 10)) - Date.parse(instanceOld.end.slice(0, 10))) / dayMs);
    const shift = (d: string, n: number) => new Date(Date.parse(d.slice(0, 10)) + n * dayMs).toISOString().slice(0, 10);
    return { start: shift(master.start, dStart), end: shift(master.end, dEnd) };
  }
  const dStart = Date.parse(instanceNew.start) - Date.parse(instanceOld.start);
  const dEnd = Date.parse(instanceNew.end) - Date.parse(instanceOld.end);
  return {
    start: new Date(Date.parse(master.start) + dStart).toISOString(),
    end: new Date(Date.parse(master.end) + dEnd).toISOString(),
  };
}

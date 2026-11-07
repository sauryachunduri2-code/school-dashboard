import type { CalendarRow, GEvent } from "../types";
import type { GoogleEvent } from "./types";

export const PROP_LIST = "sd_list";
export const PROP_STAR = "sd_star";
export const PROP_FLAG = "sd_flag";
export const PROP_TODO = "sd_todo";

export function fromGoogle(raw: GoogleEvent, calendar: Pick<CalendarRow, "id" | "read_only">): GEvent {
  const priv = raw.extendedProperties?.private ?? {};
  const allDay = !!raw.start?.date && !raw.start?.dateTime;
  return {
    id: raw.id,
    calendar_id: calendar.id,
    summary: raw.summary ?? "(No title)",
    description: raw.description ?? "",
    start: (raw.start?.dateTime ?? raw.start?.date) as string,
    end: (raw.end?.dateTime ?? raw.end?.date) as string,
    all_day: allDay,
    etag: raw.etag,
    recurring_event_id: raw.recurringEventId ?? null,
    recurrence: raw.recurrence ?? null,
    list_id: (priv[PROP_LIST] as string | undefined) || null,
    starred: priv[PROP_STAR] === "1",
    flagged: priv[PROP_FLAG] === "1",
    todo: priv[PROP_TODO] === "1",
    reminders_default: raw.reminders?.useDefault === true,
    reminders: (raw.reminders?.overrides ?? []).filter((o) => o.method === "popup").map((o) => o.minutes),
    read_only: calendar.read_only,
  };
}

/** Editable fields the dashboard can send. Undefined = leave unchanged. */
export interface EventPatch {
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  list_id?: string | null;
  starred?: boolean;
  flagged?: boolean;
  /** Replace the event's own alerts (turns the calendar default off). */
  reminders?: number[];
  /** true = go back to the calendar's default alerts. */
  reminders_default?: boolean;
  todo?: boolean;
  recurrence?: string[] | null;
}

/** What the editor's alert control shows: the calendar default, no alert, or one popup this many minutes before. */
export type AlertChoice = "default" | "none" | number;

export function alertChoiceOf(e: Pick<GEvent, "reminders" | "reminders_default"> | null): AlertChoice {
  if (!e || e.reminders_default) return "default";
  return e.reminders.length ? e.reminders[0] : "none";
}

/**
 * The reminder fields to send on save: none at all unless the user changed the control, so saving other edits
 * never rewrites the event's alerts (the calendar default, or several alerts, stay as they are).
 */
export function alertPatch(initial: AlertChoice, current: AlertChoice): Pick<EventPatch, "reminders" | "reminders_default"> {
  if (initial === current) return {};
  if (current === "default") return { reminders_default: true };
  return { reminders: current === "none" ? [] : [current] };
}

/**
 * The to-do flag lives on the series master so every occurrence changes together. Split it from the rest of a patch
 * so the API route can write it to the master while the other fields go to the instance (or series) as usual.
 */
export function splitTodo(p: EventPatch): { todo: boolean | undefined; rest: EventPatch } {
  const { todo, ...rest } = p;
  return { todo, rest };
}

export function toGoogleBody(p: EventPatch, tz?: string): Partial<GoogleEvent> {
  const body: Partial<GoogleEvent> = {};
  if (p.summary !== undefined) body.summary = p.summary;
  if (p.description !== undefined) body.description = p.description;
  if (p.start !== undefined && p.end !== undefined) {
    if (p.all_day) {
      body.start = { date: p.start.slice(0, 10) };
      body.end = { date: p.end.slice(0, 10) };
    } else {
      body.start = { dateTime: p.start, ...(tz ? { timeZone: tz } : {}) };
      body.end = { dateTime: p.end, ...(tz ? { timeZone: tz } : {}) };
    }
  }
  if (p.reminders_default) body.reminders = { useDefault: true };
  else if (p.reminders !== undefined) {
    body.reminders = {
      useDefault: false,
      overrides: p.reminders.map((minutes) => ({ method: "popup", minutes })),
    };
  }
  if (p.recurrence !== undefined) (body as { recurrence?: string[] | null }).recurrence = p.recurrence;
  // Google rejects null property values ("Required"), so a cleared value is written as "".
  const priv: Record<string, string> = {};
  if (p.list_id !== undefined) priv[PROP_LIST] = p.list_id ?? "";
  if (p.starred !== undefined) priv[PROP_STAR] = p.starred ? "1" : "";
  if (p.flagged !== undefined) priv[PROP_FLAG] = p.flagged ? "1" : "";
  if (p.todo !== undefined) priv[PROP_TODO] = p.todo ? "1" : "";
  if (Object.keys(priv).length) body.extendedProperties = { private: priv };
  return body;
}

import { addDays, parseYmd, startOfDay, ymd } from "./dates";
import { isOverdue } from "./tasks";
import type { GEvent, Task } from "./types";

export interface AgendaItem {
  key: string;
  kind: "task" | "event";
  title: string;
  /** Sort key and display time */
  at: Date;
  allDay: boolean;
  listId: string | null;
  starred: boolean;
  flagged: boolean;
  done: boolean;
  task?: Task;
  event?: GEvent;
}

export function eventRange(e: GEvent): { start: Date; end: Date } {
  if (e.all_day) return { start: parseYmd(e.start.slice(0, 10)), end: parseYmd(e.end.slice(0, 10)) };
  return { start: new Date(e.start), end: new Date(e.end) };
}

/**
 * The last day of an all-day event as the editor shows it. Google's end date is exclusive (a one-day event ends the
 * next day), so step back a calendar day (addDays, not 86,400,000 ms, which is wrong across a DST change).
 * Never earlier than the first day.
 */
export function inclusiveLastDay(start: Date, exclusiveEnd: Date): Date {
  const last = addDays(exclusiveEnd, -1);
  return last < start ? start : last;
}

/** The exclusive end date (YYYY-MM-DD) to save for an all-day event whose form shows `lastDay` (inclusive). */
export function exclusiveEndYmd(startDay: string, lastDay: string): string {
  return ymd(addDays(parseYmd(lastDay < startDay ? startDay : lastDay), 1));
}

export const taskItem = (t: Task): AgendaItem => ({
  key: `t:${t.id}`,
  kind: "task",
  title: t.title,
  at: t.due_at ? new Date(t.due_at) : new Date(0),
  allDay: t.all_day || !t.due_at,
  listId: t.list_id,
  starred: t.starred,
  flagged: t.flagged,
  done: !!t.completed_at,
  task: t,
});

export const eventItem = (e: GEvent, at?: Date): AgendaItem => ({
  key: `e:${e.calendar_id}:${e.id}`,
  kind: "event",
  title: e.summary,
  at: at ?? eventRange(e).start,
  allDay: e.all_day,
  listId: e.list_id,
  starred: e.starred,
  flagged: e.flagged,
  done: false,
  event: e,
});

export function itemsOnDay(tasks: Task[], events: GEvent[], day: Date): AgendaItem[] {
  const start = startOfDay(day);
  const end = addDays(start, 1);
  const out: AgendaItem[] = [];
  for (const t of tasks) {
    if (!t.due_at || t.completed_at) continue;
    const d = new Date(t.due_at);
    if (d >= start && d < end) out.push(taskItem(t));
  }
  for (const e of events) {
    const r = eventRange(e);
    if (r.start < end && r.end > start) out.push(eventItem(e, r.start < start ? start : r.start));
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? +a.at - +b.at : a.allDay ? -1 : 1));
}

export function buildAgenda(tasks: Task[], events: GEvent[], now: Date, days = 7) {
  const today = startOfDay(now);
  const overdue = tasks.filter((t) => isOverdue(t, now)).map(taskItem).sort((a, b) => +a.at - +b.at);
  const undated = tasks.filter((t) => !t.completed_at && !t.due_at).map(taskItem);
  const range = Array.from({ length: days }, (_, i) => addDays(today, i)).map((date) => ({
    date,
    items: itemsOnDay(tasks, events, date),
  }));
  return { overdue, days: range, undated };
}

/** Starred things with a future date, soonest first: feeds the countdown strip. */
export function countdowns(tasks: Task[], events: GEvent[], now: Date): AgendaItem[] {
  const today = startOfDay(now);
  const items: AgendaItem[] = [];
  for (const t of tasks) if (t.starred && !t.completed_at && t.due_at && new Date(t.due_at) >= today) items.push(taskItem(t));
  for (const e of events) if (e.starred && eventRange(e).start >= today) items.push(eventItem(e));
  // repeating events produce many instances; keep only the soonest per recurring series
  const seen = new Set<string>();
  return items
    .sort((a, b) => +a.at - +b.at)
    .filter((i) => {
      const k = i.event?.recurring_event_id ? `s:${i.event.recurring_event_id}` : i.key;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

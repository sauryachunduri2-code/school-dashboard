import { countdowns, eventRange, taskItem, type AgendaItem } from "./agenda";
import { addDays, daysUntil, startOfDay, startOfWeek, parseYmd, WEEK_STARTS_ON } from "./dates";
import { isEventChecked } from "./event-checks";
import { isOverdue } from "./tasks";
import { formatTakes, takesMinutes } from "./timeline";
import type { GEvent, HoursLog, Task } from "./types";

// ------------------------------------------------------------------ to-do today

export interface TodoItem {
  key: string;
  kind: "task" | "event";
  title: string;
  /** Sort and display time. Date-only items sit at local midnight. */
  at: Date;
  /** No time of day (a date-only task or an all-day event). */
  dateOnly: boolean;
  /** Open and late: shown first, in the overdue colour. */
  overdue: boolean;
  done: boolean;
  listId: string | null;
  task?: Task;
  event?: GEvent;
}

/**
 * Today's to-do list: every open or completed task due today, open tasks that are overdue, and every event occurring
 * today that is flagged as a to-do (done = checked for today). Events that aren't to-dos never appear.
 * Order: overdue (oldest first), then timed items by time, then date-only items (tasks before events).
 * Completed items keep their place.
 */
export function buildTodoList(tasks: Task[], events: GEvent[], checked: Set<string>, now: Date): TodoItem[] {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const out: TodoItem[] = [];

  for (const t of tasks) {
    if (!t.due_at) continue;
    const due = new Date(t.due_at);
    const overdue = isOverdue(t, now);
    if (!overdue && !(due >= today && due < tomorrow)) continue;
    const a = taskItem(t);
    out.push({
      key: a.key,
      kind: "task",
      title: t.title,
      at: a.allDay ? startOfDay(due) : due,
      dateOnly: a.allDay,
      overdue,
      done: !!t.completed_at,
      listId: t.list_id,
      task: t,
    });
  }

  for (const e of events) {
    if (!e.todo) continue;
    const r = eventRange(e);
    if (!(r.start < tomorrow && r.end > today)) continue;
    out.push({
      key: `e:${e.calendar_id}:${e.id}`,
      kind: "event",
      title: e.summary,
      at: e.all_day ? today : r.start < today ? today : r.start,
      dateOnly: e.all_day,
      overdue: false,
      done: isEventChecked(checked, e, today),
      listId: e.list_id,
      event: e,
    });
  }

  const group = (i: TodoItem) => (i.overdue ? 0 : i.dateOnly ? 2 : 1);
  const kindRank = (i: TodoItem) => (i.kind === "task" ? 0 : 1);
  return out.sort((a, b) => group(a) - group(b) || (group(a) === 2 ? kindRank(a) - kindRank(b) : +a.at - +b.at) || +a.at - +b.at || a.title.localeCompare(b.title));
}

export function todoProgress(items: TodoItem[]): { done: number; total: number; fraction: number } {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, fraction: items.length ? done / items.length : 0 };
}

// ------------------------------------------------------------------ up next + free time

export interface UpNext {
  title: string;
  at: Date;
  /** Started and not over yet. */
  inProgress: boolean;
  /** Whole minutes until it starts (0 when in progress). */
  minutes: number;
  kind: "task" | "event";
  listId: string | null;
  task?: Task;
  event?: GEvent;
}

/**
 * The next thing today that needs you: an unchecked timed task (at its due time), a timed to-do event that is unchecked,
 * or any timed event that hasn't started. A to-do event that is already under way counts as "now".
 * (A plain event in progress doesn't: "School, now" all day would hide what's actually next.)
 */
export function upNext(tasks: Task[], events: GEvent[], checked: Set<string>, now: Date): UpNext | null {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const cands: UpNext[] = [];
  const minutesTo = (d: Date) => Math.max(0, Math.ceil((+d - +now) / 60000));

  for (const t of tasks) {
    if (t.completed_at || !t.due_at || t.all_day) continue;
    const due = new Date(t.due_at);
    if (due <= now || due >= tomorrow) continue;
    cands.push({ title: t.title, at: due, inProgress: false, minutes: minutesTo(due), kind: "task", listId: t.list_id, task: t });
  }
  for (const e of events) {
    if (e.all_day) continue;
    const r = eventRange(e);
    if (r.start >= tomorrow || r.end <= now) continue;
    const started = r.start <= now;
    if (started) {
      if (!e.todo || isEventChecked(checked, e, today)) continue;
    } else if (e.todo && isEventChecked(checked, e, today)) continue;
    cands.push({ title: e.summary, at: r.start, inProgress: started, minutes: started ? 0 : minutesTo(r.start), kind: "event", listId: e.list_id, event: e });
  }
  cands.sort((a, b) => +a.at - +b.at);
  return cands[0] ?? null;
}

/** 0 -> "now", 25 -> "in 25 min", 60 -> "in 1h", 125 -> "in 2h 5m". */
export function formatRelative(minutes: number): string {
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${formatTakes(minutes)}`;
}

/**
 * Minutes from now until 11:59 PM that aren't covered by a timed event or an open task's block. A task block ends at its
 * due time and is `duration_minutes ?? 30` long. Overlapping and touching blocks are merged, so nothing is counted twice.
 */
export function freeMinutesLeft(tasks: Task[], events: GEvent[], now: Date): number {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
  if (+now >= +end) return 0;
  const busy: [number, number][] = [];
  const add = (a: number, b: number) => {
    const s = Math.max(a, +now);
    const e = Math.min(b, +end);
    if (e > s) busy.push([s, e]);
  };
  for (const e of events) {
    if (e.all_day) continue;
    const r = eventRange(e);
    add(+r.start, +r.end);
  }
  for (const t of tasks) {
    if (t.completed_at || !t.due_at || t.all_day) continue;
    const due = new Date(t.due_at);
    add(+due - takesMinutes(t) * 60000, +due);
  }
  busy.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of busy) {
    if (cur && s <= cur[1]) cur[1] = Math.max(cur[1], e);
    else {
      if (cur) covered += cur[1] - cur[0];
      cur = [s, e];
    }
  }
  if (cur) covered += cur[1] - cur[0];
  return Math.max(0, Math.round((+end - +now - covered) / 60000));
}

// ------------------------------------------------------------------ due soon

export interface DueSoon {
  /** Open tasks due in the next 3 days after today. */
  count: number;
  /** The first few, soonest first. */
  tasks: Task[];
  /** Open tasks that are already late (any date). */
  overdue: number;
}

export function dueSoon(tasks: Task[], now: Date, limit = 3): DueSoon {
  const from = addDays(startOfDay(now), 1);
  const to = addDays(startOfDay(now), 4);
  const soon = tasks
    .filter((t) => !t.completed_at && t.due_at && new Date(t.due_at) >= from && new Date(t.due_at) < to)
    .sort((a, b) => +new Date(a.due_at!) - +new Date(b.due_at!));
  return { count: soon.length, tasks: soon.slice(0, limit), overdue: tasks.filter((t) => isOverdue(t, now)).length };
}

// ------------------------------------------------------------------ countdown + EC hours

export interface CountdownInsight {
  item: AgendaItem;
  days: number;
}

/** The nearest upcoming starred item. */
export function nextCountdown(tasks: Task[], events: GEvent[], now: Date): CountdownInsight | null {
  const item = countdowns(tasks, events, now)[0];
  return item ? { item, days: daysUntil(item.at, now) } : null;
}

export function countdownText(days: number): string {
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface EcHours {
  thisWeek: number;
  lastWeek: number;
  /** thisWeek - lastWeek, rounded to 0.1. */
  delta: number;
}

/** Hours logged this week (Sunday start) against the week before. */
export function ecHours(logs: HoursLog[], now: Date): EcHours {
  const weekStart = startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON });
  const lastStart = addDays(weekStart, -7);
  const nextStart = addDays(weekStart, 7);
  let thisWeek = 0;
  let lastWeek = 0;
  for (const l of logs) {
    const d = parseYmd(l.date);
    if (d >= weekStart && d < nextStart) thisWeek += l.hours;
    else if (d >= lastStart && d < weekStart) lastWeek += l.hours;
  }
  return { thisWeek: round1(thisWeek), lastWeek: round1(lastWeek), delta: round1(thisWeek - lastWeek) };
}

/** "+1", "-0.5", "same". */
export function formatDelta(delta: number): string {
  if (delta === 0) return "same";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
}


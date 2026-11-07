import { minutesOfDay, placeTimed, type CalItem, type Placed } from "@/components/calendar/layout";
import { eventItem, eventRange, taskItem, type AgendaItem } from "./agenda";
import { addDays, startOfDay } from "./dates";
import type { CalendarRow, GEvent, List, Task } from "./types";

/** Home timeline scale: same as the calendar week grid. */
export const HOME_HOUR_H = 52;
/** Every day starts at 4:00 AM and runs to the end of the day... */
export const DEFAULT_WINDOW_START = 4 * 60;
export const WINDOW_END = 24 * 60;
/** ...unless something timed lands between 12:00 and 4:00 AM, which pulls that one day's start earlier. */
export const EARLY_END = DEFAULT_WINDOW_START;
/** A task with no "takes" length is drawn 30 minutes tall. */
export const DEFAULT_TAKES = 30;
/** Shortest block drawn (minutes), so a 15 minute task still fits a line of text. */
export const MIN_BLOCK_MIN = 24;

/** How long a task takes, in minutes (30 when unset or invalid). */
export function takesMinutes(t: Pick<Task, "duration_minutes">): number {
  const d = t.duration_minutes;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? Math.min(d, 1440) : DEFAULT_TAKES;
}

/** 15 -> "15m", 60 -> "1h", 90 -> "1h 30m". */
export function formatTakes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

export function itemColor(listId: string | null, calendarId: string | null, lists: List[], calendars: CalendarRow[]): string {
  return lists.find((l) => l.id === listId)?.color ?? calendars.find((c) => c.id === calendarId)?.color ?? "var(--ink-3)";
}

/**
 * Every timed thing as a CalItem. A task block ENDS at its due time and is `takes` tall; completed tasks
 * are kept (the Home timeline draws them faded). All-day events are included with allDay set; the timeline skips them.
 */
export function homeTimedItems(tasks: Task[], events: GEvent[], lists: List[], calendars: CalendarRow[]): CalItem[] {
  const out: CalItem[] = [];
  for (const t of tasks) {
    if (!t.due_at || t.all_day) continue;
    const end = new Date(t.due_at);
    out.push({
      key: `t:${t.id}`,
      kind: "task",
      title: t.title,
      start: new Date(+end - takesMinutes(t) * 60000),
      end,
      allDay: false,
      color: itemColor(t.list_id, null, lists, calendars),
      done: !!t.completed_at,
      draggable: false,
      readOnly: false,
      task: t,
    });
  }
  for (const e of events) {
    if (e.all_day) continue;
    const r = eventRange(e);
    out.push({
      key: `e:${e.calendar_id}:${e.id}`,
      kind: "event",
      title: e.summary,
      start: r.start,
      end: r.end,
      allDay: false,
      color: itemColor(e.list_id, e.calendar_id, lists, calendars),
      done: false,
      draggable: false,
      readOnly: e.read_only,
      event: e,
    });
  }
  return out;
}

/** Start of a day's window, in minutes after midnight: 4 AM, or the hour at/before the earliest 12-4 AM item. */
export function dayWindowStart(earlyStartMins: number[]): number {
  if (!earlyStartMins.length) return DEFAULT_WINDOW_START;
  return Math.max(0, Math.min(DEFAULT_WINDOW_START, Math.floor(Math.min(...earlyStartMins) / 60) * 60));
}

export interface DayTimeline {
  date: Date;
  /** Window start (minutes after midnight); the window always runs to midnight. */
  startMin: number;
  endMin: number;
  /** top/height are minutes after midnight, already clipped to the window */
  placed: Placed[];
}

/**
 * One day's timed blocks. Events are split at midnight (each day gets its own part). A task lives on its due day:
 * it ends at the due time and starts `takes` earlier. Anything starting before the window is clipped to it.
 * Overlaps are packed side by side by the calendar's placeTimed.
 */
export function buildDayTimeline(day: Date, items: CalItem[]): DayTimeline {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const toMin = (d: Date) => (d <= dayStart ? 0 : d >= dayEnd ? WINDOW_END : minutesOfDay(d));

  const segs: { item: CalItem; a: number; b: number; early: boolean }[] = [];
  for (const item of items) {
    if (item.allDay) continue;
    if (item.kind === "task") {
      const due = item.end;
      if (due < dayStart || due >= dayEnd) continue;
      const b = toMin(due);
      const len = Math.max(item.task ? takesMinutes(item.task) : DEFAULT_TAKES, MIN_BLOCK_MIN);
      segs.push({ item, a: Math.max(0, b - len), b, early: b <= EARLY_END });
    } else {
      if (!(item.start < dayEnd && item.end > dayStart)) continue;
      const a = toMin(item.start);
      segs.push({ item, a, b: Math.max(a, toMin(item.end)), early: a < EARLY_END });
    }
  }

  const startMin = dayWindowStart(segs.filter((s) => s.early).map((s) => s.a));
  const at = (min: number) => new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, min);
  const clipped: CalItem[] = segs.map(({ item, a, b }) => {
    const a2 = Math.max(a, startMin);
    return { ...item, start: at(a2), end: at(Math.max(b, a2)) };
  });
  return { date: dayStart, startMin, endMin: WINDOW_END, placed: placeTimed(clipped, dayStart, MIN_BLOCK_MIN) };
}

export interface UntimedEntry {
  item: AgendaItem;
  /** Due before today; shown on Today. */
  overdue: boolean;
}

/**
 * Items without a time slot, one list per day starting at `now`'s day: date-only tasks, all-day events
 * (on each day they cover) and overdue tasks (open tasks due before today, any kind), which all land on Today.
 * A timed task that is only late earlier today stays in the timeline.
 */
export function untimedByDay(tasks: Task[], events: GEvent[], now: Date, days = 7): UntimedEntry[][] {
  const today = startOfDay(now);
  const out: UntimedEntry[][] = Array.from({ length: days }, () => []);
  for (const t of tasks) {
    if (!t.due_at) continue;
    const due = new Date(t.due_at);
    if (due < today) {
      if (!t.completed_at) out[0].push({ item: taskItem(t), overdue: true });
      continue;
    }
    if (!t.all_day) continue;
    const i = Math.round((+startOfDay(due) - +today) / 86400000);
    if (i >= 0 && i < days) out[i].push({ item: taskItem(t), overdue: false });
  }
  for (const e of events) {
    if (!e.all_day) continue;
    const r = eventRange(e);
    for (let i = 0; i < days; i++) {
      const s = addDays(today, i);
      if (r.start < addDays(s, 1) && r.end > s) out[i].push({ item: eventItem(e, s), overdue: false });
    }
  }
  const rank = (x: UntimedEntry) => (x.overdue ? 0 : x.item.kind === "event" ? 1 : x.item.done ? 3 : 2);
  for (const list of out) list.sort((a, b) => rank(a) - rank(b) || +a.item.at - +b.item.at);
  return out;
}

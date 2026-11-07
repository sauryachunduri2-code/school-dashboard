import { addDays, parseYmd, startOfDay, ymd } from "@/lib/dates";
import { eventRange } from "@/lib/agenda";
import type { GEvent, List, Task, CalendarRow } from "@/lib/types";

export const HOUR_H = 52;
export const SNAP_MIN = 15;
export const TASK_MIN = 30;

export interface CalItem {
  /** Unique per rendered occurrence (multi-day all-day events render once per day) */
  key: string;
  kind: "task" | "event";
  title: string;
  /** Start/end of the true item (not clipped to the day) */
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  done: boolean;
  draggable: boolean;
  readOnly: boolean;
  task?: Task;
  event?: GEvent;
}

export function toCalItems(tasks: Task[], events: GEvent[], lists: List[], calendars: CalendarRow[]): CalItem[] {
  const out: CalItem[] = [];
  const listColor = (id: string | null) => lists.find((l) => l.id === id)?.color;
  for (const t of tasks) {
    if (!t.due_at || t.completed_at) continue;
    const start = new Date(t.due_at);
    const allDay = t.all_day;
    out.push({
      key: `t:${t.id}`,
      kind: "task",
      title: t.title,
      start,
      end: allDay ? addDays(start, 1) : new Date(+start + TASK_MIN * 60000),
      allDay,
      color: listColor(t.list_id) ?? "var(--ink-3)",
      done: false,
      draggable: true,
      readOnly: false,
      task: t,
    });
  }
  for (const e of events) {
    const r = eventRange(e);
    out.push({
      key: `e:${e.calendar_id}:${e.id}`,
      kind: "event",
      title: e.summary,
      start: r.start,
      end: r.end,
      allDay: e.all_day,
      color: listColor(e.list_id) ?? calendars.find((c) => c.id === e.calendar_id)?.color ?? "var(--ink-3)",
      done: false,
      draggable: !e.read_only,
      readOnly: e.read_only,
      event: e,
    });
  }
  return out;
}

export function overlapsDay(i: CalItem, day: Date): boolean {
  const s = startOfDay(day);
  const e = addDays(s, 1);
  return i.start < e && i.end > s;
}

export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

export interface Placed {
  item: CalItem;
  top: number; // minutes from midnight
  height: number; // minutes
  col: number;
  cols: number;
}

/** Greedy column packing so overlapping items sit side by side. `minMinutes` is the shortest block (and overlap span) an item gets. */
export function placeTimed(items: CalItem[], day: Date, minMinutes = TASK_MIN): Placed[] {
  const s = startOfDay(day);
  const e = addDays(s, 1);
  const rows = items
    .filter((i) => !i.allDay)
    .map((item) => {
      const a = item.start < s ? s : item.start;
      const b = item.end > e ? e : item.end;
      const top = minutesOfDay(a);
      const dur = Math.max(minMinutes, Math.round((+b - +a) / 60000));
      return { item, top, end: Math.min(1440, top + dur) };
    })
    .sort((x, y) => x.top - y.top || y.end - x.end);

  const placed: Placed[] = [];
  let cluster: { p: Placed; end: number }[] = [];
  let clusterEnd = -1;
  const colEnds: number[] = [];
  const flush = () => {
    const n = colEnds.length || 1;
    cluster.forEach(({ p }) => (p.cols = n));
    cluster = [];
    colEnds.length = 0;
  };
  for (const r of rows) {
    if (r.top >= clusterEnd && cluster.length) {
      flush();
      clusterEnd = -1;
    }
    let col = colEnds.findIndex((end) => end <= r.top);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(r.end);
    } else colEnds[col] = r.end;
    const p: Placed = { item: r.item, top: r.top, height: r.end - r.top, col, cols: 1 };
    placed.push(p);
    cluster.push({ p, end: r.end });
    clusterEnd = Math.max(clusterEnd, r.end);
  }
  if (cluster.length) flush();
  return placed;
}

export interface MoveResult {
  start: Date;
  end: Date;
}

/** Shift an item by whole days and (for timed items) minutes. */
export function moveItem(i: CalItem, dayShift: number, minuteShift: number): MoveResult {
  if (i.allDay) return { start: addDays(i.start, dayShift), end: addDays(i.end, dayShift) };
  const shiftLocal = (d: Date) => {
    // keep wall-clock time stable across DST by shifting via local date parts
    const n = new Date(d);
    n.setDate(n.getDate() + dayShift);
    n.setMinutes(n.getMinutes() + minuteShift);
    return n;
  };
  return { start: shiftLocal(i.start), end: shiftLocal(i.end) };
}

export const snap = (minutes: number) => Math.round(minutes / SNAP_MIN) * SNAP_MIN;

export function eventPatchFor(i: CalItem, r: MoveResult) {
  if (i.allDay) return { start: ymd(r.start), end: ymd(r.end), all_day: true };
  return { start: r.start.toISOString(), end: r.end.toISOString(), all_day: false };
}

export { parseYmd };

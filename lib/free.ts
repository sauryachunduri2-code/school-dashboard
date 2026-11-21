import { eventRange } from "./agenda";
import { buildTodoList } from "./insights";
import { addDays, startOfDay } from "./dates";
import { isOverdue } from "./tasks";
import { takesMinutes } from "./timeline";
import type { GEvent, Task } from "./types";

/** What an all-day to-do event counts as tonight, like an untimed task's default length. */
const DEFAULT_EVENT_MINUTES = 30;

export interface Span {
  start: Date;
  end: Date;
}

export interface Gap extends Span {
  minutes: number;
}

/** Day's end hour (local), the cut-off for "tonight". */
export const DAY_END_HOUR = 22;

/**
 * Gaps in [from, to) not covered by any busy span. Busy spans may overlap, nest, touch or sit outside the window.
 * Gaps shorter than `minMinutes` are dropped; `minutes` is rounded down.
 */
export function freeGaps(busy: Span[], from: Date, to: Date, minMinutes: number): Gap[] {
  const out: Gap[] = [];
  const push = (start: Date, end: Date) => {
    const minutes = Math.floor((+end - +start) / 60_000);
    if (minutes >= minMinutes) out.push({ start, end, minutes });
  };
  let cursor = from;
  for (const b of [...busy].sort((a, c) => +a.start - +c.start)) {
    if (cursor >= to) break;
    if (b.start > cursor) push(cursor, b.start < to ? b.start : to);
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < to) push(cursor, to);
  return out;
}

export interface Capacity {
  workMinutes: number;
  freeMinutes: number;
  taskCount: number;
}

/**
 * What tonight holds. Work: open tasks due today or already overdue, plus today's open to-do events (a timed one counts
 * its length, an all-day one 30 minutes; `checked` holds the ones ticked off, see lib/event-checks.ts). Free: gaps from
 * now until `dayEndHour` (local), with other timed events and open timed tasks (a block ending at its due time) as busy
 * time. To-do events aren't busy time: they are the work being measured.
 */
export function tonightCapacity({
  tasks,
  events,
  now,
  checked = new Set<string>(),
  dayEndHour = DAY_END_HOUR,
  minGapMinutes = 15,
}: {
  tasks: Task[];
  events: GEvent[];
  now: Date;
  checked?: Set<string>;
  dayEndHour?: number;
  minGapMinutes?: number;
}): Capacity {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const work = tasks.filter((t) => {
    if (t.completed_at || !t.due_at) return false;
    const due = new Date(t.due_at);
    return isOverdue(t, now) || (due >= today && due < tomorrow);
  });

  const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), dayEndHour);
  const todoEvents = buildTodoList([], events, checked, now).filter((i) => i.kind === "event" && !i.done);
  const eventMinutes = (e: GEvent) => (e.all_day ? DEFAULT_EVENT_MINUTES : Math.max(1, Math.round((+eventRange(e).end - +eventRange(e).start) / 60_000)));
  const busy: Span[] = events.filter((e) => !e.all_day && !e.todo).map(eventRange);
  for (const t of tasks) {
    if (t.completed_at || !t.due_at || t.all_day) continue;
    const due = new Date(t.due_at);
    busy.push({ start: new Date(+due - takesMinutes(t) * 60_000), end: due });
  }
  const freeMinutes = now >= dayEnd ? 0 : freeGaps(busy, now, dayEnd, minGapMinutes).reduce((sum, g) => sum + g.minutes, 0);

  return {
    workMinutes: work.reduce((sum, t) => sum + takesMinutes(t), 0) + todoEvents.reduce((sum, i) => sum + eventMinutes(i.event!), 0),
    freeMinutes,
    taskCount: work.length + todoEvents.length,
  };
}

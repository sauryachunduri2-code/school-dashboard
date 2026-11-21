import { eventRange } from "./agenda";
import { addDays, startOfDay } from "./dates";
import { isOverdue } from "./tasks";
import { takesMinutes } from "./timeline";
import type { GEvent, Task } from "./types";

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
 * What tonight holds. Work: open tasks due today or already overdue. Free: gaps from now until `dayEndHour` (local),
 * with timed events and open timed tasks (a block ending at its due time) as busy time.
 */
export function tonightCapacity({
  tasks,
  events,
  now,
  dayEndHour = DAY_END_HOUR,
  minGapMinutes = 15,
}: {
  tasks: Task[];
  events: GEvent[];
  now: Date;
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
  const busy: Span[] = events.filter((e) => !e.all_day).map(eventRange);
  for (const t of tasks) {
    if (t.completed_at || !t.due_at || t.all_day) continue;
    const due = new Date(t.due_at);
    busy.push({ start: new Date(+due - takesMinutes(t) * 60_000), end: due });
  }
  const freeMinutes = now >= dayEnd ? 0 : freeGaps(busy, now, dayEnd, minGapMinutes).reduce((sum, g) => sum + g.minutes, 0);

  return {
    workMinutes: work.reduce((sum, t) => sum + takesMinutes(t), 0),
    freeMinutes,
    taskCount: work.length,
  };
}

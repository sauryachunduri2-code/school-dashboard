import { freeGaps } from "../free";
import type { GEvent, List, Task } from "../types";
import type { BriefFacts, BriefItem, FreeBlock } from "./types";
import { addDaysYmd, clock, dayBounds, zonedMidnight, zonedYmd } from "./zone";

export interface FactsInput {
  tasks: Task[];
  events: GEvent[];
  lists: List[];
  now: Date;
  tz: string;
  /** Defaults to today in `tz` */
  date?: string;
}

const MAX_TODAY = 25;
const MAX_OVERDUE = 5;
const MAX_UPCOMING = 5;
const MIN_FREE_MIN = 45;
const DAY_END_HOUR = 22;

export function buildFacts({ tasks, events, lists, now, tz, date }: FactsInput): BriefFacts {
  const ymd = date ?? zonedYmd(now, tz);
  const { from, to } = dayBounds(ymd, tz);
  const listName = (id: string | null) => (id ? (lists.find((l) => l.id === id)?.name ?? null) : null);

  const taskItem = (t: Task): BriefItem => {
    const due = t.due_at ? new Date(t.due_at) : null;
    return {
      kind: "task", title: t.title.trim(), start: due?.toISOString() ?? null, end: null, allDay: t.all_day || !due,
      time: due && !t.all_day ? clock(due, tz) : null, endTime: null, list: listName(t.list_id), starred: t.starred, flagged: t.flagged,
    };
  };
  const eventItem = (e: GEvent): BriefItem => {
    const start = e.all_day ? zonedMidnight(e.start.slice(0, 10), tz) : new Date(e.start);
    const end = e.all_day ? zonedMidnight(e.end.slice(0, 10), tz) : new Date(e.end);
    return {
      kind: "event", title: e.summary.trim() || "(No title)", start: start.toISOString(), end: end.toISOString(), allDay: e.all_day,
      time: e.all_day ? null : clock(start, tz), endTime: e.all_day ? null : clock(end, tz), list: listName(e.list_id),
      starred: e.starred, flagged: e.flagged,
    };
  };
  const overlaps = (i: BriefItem, a: Date, b: Date) => {
    if (!i.start) return false;
    const s = new Date(i.start);
    const e = i.end ? new Date(i.end) : s;
    return i.kind === "task" ? s >= a && s < b : s < b && (e > a || +e === +s && s >= a);
  };
  const order = (a: BriefItem, b: BriefItem) =>
    a.allDay === b.allDay ? +new Date(a.start ?? 0) - +new Date(b.start ?? 0) : a.allDay ? -1 : 1;

  const open = tasks.filter((t) => !t.completed_at);
  const items = [...open.map(taskItem), ...events.map(eventItem)];
  const today = items.filter((i) => overlaps(i, from, to)).sort(order).slice(0, MAX_TODAY);

  const overdue = open
    .filter((t) => t.due_at && new Date(t.due_at) < from)
    .sort((a, b) => +new Date(a.due_at!) - +new Date(b.due_at!))
    .slice(0, MAX_OVERDUE)
    .map(taskItem);

  const horizon = zonedMidnight(addDaysYmd(ymd, 8), tz);
  const seen = new Set<string>();
  const upcoming = items
    .filter((i) => (i.starred || i.flagged) && i.start && new Date(i.start) >= to && new Date(i.start) < horizon)
    .sort((a, b) => +new Date(a.start!) - +new Date(b.start!))   // soonest first, all-day or not
    .filter((i) => (seen.has(i.title) ? false : (seen.add(i.title), true)))   // one per repeating title
    .slice(0, MAX_UPCOMING)
    .map((i) => ({ ...i, daysAway: daysBetween(ymd, zonedYmd(new Date(i.start!), tz)) }));

  const timed = today.filter((i) => !i.allDay && i.start);
  const next = timed.find((i) => new Date(i.start!) > now) ?? null;

  return {
    date: ymd,
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(from),
    tz,
    now: now.toISOString(),
    nowTime: clock(now, tz),
    today,
    next,
    overdue,
    upcoming,
    free: freeBlocks(timed, now > from ? now : from, new Date(+from + DAY_END_HOUR * 3600_000), tz),
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Gaps between timed things. Events block their span; a timed task blocks the 30 min before it's due. */
export function freeBlocks(timed: BriefItem[], from: Date, until: Date, tz: string): FreeBlock[] {
  const busy = timed.map((i) => {
    const s = new Date(i.start!);
    return i.kind === "event" ? { start: s, end: new Date(i.end ?? i.start!) } : { start: new Date(+s - 30 * 60_000), end: s };
  });
  return freeGaps(busy, from, until, MIN_FREE_MIN).map(({ start, end, minutes }) => ({
    start: start.toISOString(),
    end: end.toISOString(),
    time: clock(start, tz),
    endTime: clock(end, tz),
    minutes,
  }));
}

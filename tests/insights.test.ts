import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { checkIdFor, checkSet, EVENT_CHECKS_KEY, toggleEventCheck, type EventCheck } from "@/lib/event-checks";
import { fromGoogle, splitTodo, toGoogleBody } from "@/lib/google/mapping";
import { mergeDelta, setSeriesTodo, type EventsCache } from "@/lib/google/merge";
import type { GoogleEvent } from "@/lib/google/types";
import { buildTodoList, countdownText, dueSoon, ecHours, formatDelta, formatRelative, freeMinutesLeft, nextCountdown, todoProgress, upNext } from "@/lib/insights";
import { newTask } from "@/lib/tasks";
import type { GEvent, HoursLog, Task } from "@/lib/types";

// Fri Nov 6 2026, 12:00 (New York)
const NOW = new Date(2026, 10, 6, 12, 0);
const at = (day: number, h = 0, m = 0) => new Date(2026, 10, day, h, m);
const iso = (d: Date) => d.toISOString();

const task = (over: Partial<Task> & { title: string }): Task => newTask({ all_day: false, ...over });
const timedTask = (title: string, day: number, h: number, m = 0, over: Partial<Task> = {}) => task({ title, due_at: iso(at(day, h, m)), ...over });
const dateTask = (title: string, day: number, over: Partial<Task> = {}) => task({ title, due_at: iso(at(day)), all_day: true, ...over });

const ev = (over: Partial<GEvent> & { id: string }): GEvent => ({
  calendar_id: "c",
  summary: over.id,
  description: "",
  start: iso(at(6, 15)),
  end: iso(at(6, 16)),
  all_day: false,
  etag: "x",
  recurring_event_id: null,
  recurrence: null,
  list_id: null,
  starred: false,
  flagged: false,
  todo: false,
  reminders: [],
  read_only: false,
  ...over,
});
const timedEv = (id: string, sh: number, eh: number, over: Partial<GEvent> = {}) => ev({ id, start: iso(at(6, sh)), end: iso(at(6, eh)), ...over });
const allDayEv = (id: string, day: number, over: Partial<GEvent> = {}) => ev({ id, all_day: true, start: `2026-11-0${day}`, end: `2026-11-0${day + 1}`, ...over });
const titles = (items: { title: string }[]) => items.map((i) => i.title);
const none = new Set<string>();

describe("to-do today composition and order", () => {
  it("includes tasks due today (open and done) and todo events; excludes other events and other days", () => {
    const tasks = [timedTask("Anki", 6, 21), timedTask("Done early", 6, 9, 0, { completed_at: iso(at(6, 9, 30)) }), timedTask("Tomorrow", 7, 9), dateTask("Next week", 10), task({ title: "Someday" })];
    const events = [timedEv("Lunch", 12, 13, { todo: true }), timedEv("Bed", 22, 23), timedEv("Mon todo", 9, 10, { todo: true, start: iso(at(9, 9)), end: iso(at(9, 10)) })];
    expect(titles(buildTodoList(tasks, events, none, NOW))).toEqual(["Done early", "Lunch", "Anki"]);
  });
  it("puts overdue open tasks first (oldest first), then timed by time, then date-only (tasks before events)", () => {
    const tasks = [
      dateTask("HW", 6),
      timedTask("Anki", 6, 21),
      timedTask("Late today", 6, 9), // due 9:00, it is 12:00 -> overdue
      dateTask("Old", 2), // overdue from days ago
      dateTask("Yesterday", 5),
    ];
    const events = [timedEv("Lunch", 12, 13, { todo: true }), allDayEv("Spirit day", 6, { todo: true })];
    const list = buildTodoList(tasks, events, none, NOW);
    expect(titles(list)).toEqual(["Old", "Yesterday", "Late today", "Lunch", "Anki", "HW", "Spirit day"]);
    expect(list.filter((i) => i.overdue).map((i) => i.title)).toEqual(["Old", "Yesterday", "Late today"]);
  });
  it("completed items keep their position and are not overdue", () => {
    const tasks = [timedTask("Morning", 6, 9, 0, { completed_at: iso(at(6, 9, 5)) }), timedTask("Noon", 6, 13)];
    const list = buildTodoList(tasks, [timedEv("Lunch", 12, 13, { todo: true })], none, NOW);
    expect(list.map((i) => [i.title, i.done, i.overdue])).toEqual([
      ["Morning", true, false],
      ["Lunch", false, false],
      ["Noon", false, false],
    ]);
  });
  it("a completed task from a past day doesn't show", () => {
    expect(buildTodoList([dateTask("Old", 2, { completed_at: iso(at(2, 10)) })], [], none, NOW)).toEqual([]);
  });
  it("event checks are per day: checked today only marks today", () => {
    const lunch = timedEv("Lunch", 12, 13, { todo: true });
    const checked = checkSet([{ calendar_id: "c", event_key: "Lunch", day: "2026-11-06", checked_at: "x" }]);
    expect(buildTodoList([], [lunch], checked, NOW)[0].done).toBe(true);
    expect(buildTodoList([], [lunch], checked, at(7, 12))).toEqual([]); // not on tomorrow's list at all
    const tomorrowEv = timedEv("Lunch", 12, 13, { todo: true, start: iso(at(7, 12)), end: iso(at(7, 13)) });
    expect(buildTodoList([], [tomorrowEv], checked, at(7, 8))[0].done).toBe(false);
  });
  it("a recurring event's check is shared by the series (key = recurring_event_id)", () => {
    const inst = timedEv("inst-1", 12, 13, { todo: true, recurring_event_id: "series" });
    const checked = checkSet([{ calendar_id: "c", event_key: "series", day: "2026-11-06", checked_at: "x" }]);
    expect(buildTodoList([], [inst], checked, NOW)[0].done).toBe(true);
  });
  it("an event running past midnight shows on both days", () => {
    const late = ev({ id: "late", todo: true, start: iso(at(6, 22)), end: iso(at(7, 1)) });
    expect(buildTodoList([], [late], none, NOW)).toHaveLength(1);
    expect(buildTodoList([], [late], none, at(7, 8))).toHaveLength(1);
  });
});

describe("today's progress", () => {
  it("counts done over the whole list, overdue included", () => {
    const list = buildTodoList([timedTask("a", 6, 9, 0, { completed_at: iso(at(6, 10)) }), timedTask("b", 6, 21), dateTask("c", 3)], [timedEv("l", 12, 13, { todo: true })], none, NOW);
    expect(todoProgress(list)).toEqual({ done: 1, total: 4, fraction: 0.25 });
  });
  it("an empty list is 0 of 0", () => expect(todoProgress([])).toEqual({ done: 0, total: 0, fraction: 0 }));
});

describe("up next", () => {
  it("picks the soonest unchecked timed task or event and reports minutes", () => {
    const n = upNext([timedTask("Anki", 6, 12, 25)], [timedEv("Club", 14, 15)], none, NOW)!;
    expect(n).toMatchObject({ title: "Anki", minutes: 25, inProgress: false, kind: "task" });
    expect(formatRelative(n.minutes)).toBe("in 25 min");
  });
  it("skips done tasks, date-only tasks, all-day events, checked todo events, and tomorrow", () => {
    const tasks = [timedTask("done", 6, 13, 0, { completed_at: iso(at(6, 12)) }), dateTask("date only", 6), timedTask("tomorrow", 7, 9)];
    const events = [allDayEv("all day", 6), timedEv("checked", 13, 14, { todo: true })];
    const checked = checkSet([{ calendar_id: "c", event_key: "checked", day: "2026-11-06", checked_at: "x" }]);
    expect(upNext(tasks, events, checked, NOW)).toBeNull();
  });
  it("a to-do event in progress is 'now'; a plain event in progress is not 'up next'", () => {
    const running = upNext([], [timedEv("Study hall", 11, 13, { todo: true })], none, NOW)!;
    expect(running).toMatchObject({ title: "Study hall", inProgress: true, minutes: 0 });
    expect(formatRelative(running.minutes)).toBe("now");
    expect(upNext([], [timedEv("School", 8, 15), timedEv("Club", 16, 17)], none, NOW)!.title).toBe("Club");
  });
  it("overdue timed tasks (already past) are not 'next'", () => expect(upNext([timedTask("late", 6, 9)], [], none, NOW)).toBeNull());
  it("formats relative times", () => {
    expect(formatRelative(60)).toBe("in 1h");
    expect(formatRelative(125)).toBe("in 2h 5m");
    expect(formatRelative(0)).toBe("now");
  });
});

describe("free time left today", () => {
  const END = (12 * 60) - 1; // minutes from 12:00 to 23:59 = 719
  it("is the whole rest of the day when nothing is scheduled", () => expect(freeMinutesLeft([], [], NOW)).toBe(END));
  it("subtracts events", () => expect(freeMinutesLeft([], [timedEv("a", 14, 15)], NOW)).toBe(END - 60));
  it("a task block ends at due_at and is 30 minutes by default, or duration_minutes", () => {
    expect(freeMinutesLeft([timedTask("a", 6, 21)], [], NOW)).toBe(END - 30);
    expect(freeMinutesLeft([timedTask("a", 6, 21, 0, { duration_minutes: 90 })], [], NOW)).toBe(END - 90);
  });
  it("merges overlapping and touching intervals instead of double counting", () => {
    // event 14-16, event 15-17 (overlap), task block 16:30-17:00 inside, task 17:00-17:30 touching: busy 14:00-17:30 = 210
    const events = [timedEv("a", 14, 16), timedEv("b", 15, 17)];
    const tasks = [timedTask("t1", 6, 17), timedTask("t2", 6, 17, 30)];
    expect(freeMinutesLeft(tasks, events, NOW)).toBe(END - 210);
    // a nested event adds nothing
    expect(freeMinutesLeft(tasks, [...events, timedEv("inner", 14, 15)], NOW)).toBe(END - 210);
  });
  it("only counts time from now onward", () => {
    // 9-13 event: only 12-13 is left
    expect(freeMinutesLeft([], [timedEv("a", 9, 13)], NOW)).toBe(END - 60);
    expect(freeMinutesLeft([timedTask("past", 6, 9)], [], NOW)).toBe(END);
  });
  it("ignores all-day events and done or date-only tasks", () => {
    const tasks = [timedTask("done", 6, 21, 0, { completed_at: iso(at(6, 11)) }), dateTask("d", 6)];
    expect(freeMinutesLeft(tasks, [allDayEv("x", 6)], NOW)).toBe(END);
  });
  it("clips to 11:59 PM and is 0 at the end of the day", () => {
    expect(freeMinutesLeft([], [ev({ id: "late", start: iso(at(6, 22)), end: iso(at(7, 3)) })], NOW)).toBe(END - (23 * 60 + 59 - 22 * 60));
    expect(freeMinutesLeft([], [], at(6, 23, 59))).toBe(0);
  });
});

describe("due soon", () => {
  it("counts open tasks due in the 3 days after today, soonest first, and counts overdue separately", () => {
    const tasks = [
      dateTask("today", 6),
      dateTask("sat", 7),
      timedTask("sun", 8, 9),
      dateTask("mon", 9),
      dateTask("tue (day 4)", 10),
      dateTask("done", 7, { completed_at: iso(at(6, 8)) }),
      dateTask("late", 4),
      timedTask("late today", 6, 9),
    ];
    const s = dueSoon(tasks, NOW);
    expect(s.count).toBe(3);
    expect(titles(s.tasks)).toEqual(["sat", "sun", "mon"]);
    expect(s.overdue).toBe(2);
  });
  it("lists at most 3 titles but counts all", () => {
    const tasks = [7, 8, 9].flatMap((d) => [dateTask(`a${d}`, d), dateTask(`b${d}`, d)]);
    const s = dueSoon(tasks, NOW);
    expect(s.count).toBe(6);
    expect(s.tasks).toHaveLength(3);
  });
});

describe("countdown and EC hours", () => {
  it("finds the nearest starred item", () => {
    const events = [ev({ id: "far", summary: "HOSA SLC", starred: true, all_day: true, start: "2026-12-14", end: "2026-12-15" }), ev({ id: "x", summary: "plain" })];
    const cd = nextCountdown([dateTask("Essay", 20, { starred: true })], events, NOW)!;
    expect(cd.item.title).toBe("Essay");
    expect(cd.days).toBe(14);
    expect(nextCountdown([], events, NOW)!.days).toBe(38);
    expect(countdownText(38)).toBe("in 38 days");
    expect(countdownText(1)).toBe("tomorrow");
    expect(countdownText(0)).toBe("today");
    expect(nextCountdown([], [], NOW)).toBeNull();
  });
  const log = (date: string, hours: number): HoursLog => ({ id: date + hours, date, list_id: null, hours, note: "", created_at: "" });
  it("compares this week (Sunday start) to last week", () => {
    // this week: Sun Nov 1 .. Sat Nov 7; last week: Oct 25 .. 31
    const logs = [log("2026-11-01", 2), log("2026-11-05", 2.5), log("2026-10-25", 3), log("2026-10-31", 0.5), log("2026-10-24", 9), log("2026-11-08", 9)];
    expect(ecHours(logs, NOW)).toEqual({ thisWeek: 4.5, lastWeek: 3.5, delta: 1 });
    expect(formatDelta(1)).toBe("+1");
    expect(formatDelta(-0.5)).toBe("−0.5");
    expect(formatDelta(0)).toBe("same");
  });
  it("handles no logs", () => expect(ecHours([], NOW)).toEqual({ thisWeek: 0, lastWeek: 0, delta: 0 }));
});

describe("sd_todo on the Google event", () => {
  const raw = (extra: Partial<GoogleEvent> = {}): GoogleEvent => ({ id: "a", etag: "e", start: { dateTime: "2026-11-09T15:00:00-05:00" }, end: { dateTime: "2026-11-09T16:00:00-05:00" }, ...extra });
  const cal = { id: "primary", read_only: false };
  it("reads sd_todo = 1", () => {
    expect(fromGoogle(raw({ extendedProperties: { private: { sd_todo: "1" } } }), cal).todo).toBe(true);
    expect(fromGoogle(raw({ extendedProperties: { private: { sd_todo: "" } } }), cal).todo).toBe(false);
    expect(fromGoogle(raw(), cal).todo).toBe(false);
  });
  it('writes "1" to set and "" (never null) to clear', () => {
    expect(toGoogleBody({ todo: true }).extendedProperties?.private).toEqual({ sd_todo: "1" });
    expect(toGoogleBody({ todo: false }).extendedProperties?.private).toEqual({ sd_todo: "" });
    expect(toGoogleBody({ summary: "x" }).extendedProperties).toBeUndefined();
  });
  it("splits the flag off a patch so the route can send it to the series master", () => {
    expect(splitTodo({ summary: "x", todo: true })).toEqual({ todo: true, rest: { summary: "x" } });
    expect(splitTodo({ summary: "x" })).toEqual({ todo: undefined, rest: { summary: "x" } });
  });
  it("setSeriesTodo flips every cached occurrence of the series and nothing else", () => {
    const mk = (id: string, series: string | null) => ev({ id, recurring_event_id: series });
    let cache: EventsCache | undefined = mergeDelta(undefined, { calendarId: "c", events: [mk("i1", "s"), mk("i2", "s"), mk("other", "t"), mk("solo", null)], deleted: [], nextSyncToken: "tok", fullResync: true });
    cache = setSeriesTodo(cache, "c", "s", true);
    const todo = Object.fromEntries(Object.entries(cache.c.events).map(([id, e]) => [id, e.todo]));
    expect(todo).toEqual({ i1: true, i2: true, other: false, solo: false });
    expect(cache.c.syncToken).toBe("tok");
  });
});

describe("per-day event checks", () => {
  const lunch = ev({ id: "lunch", recurring_event_id: "series" });
  const day = at(6);
  it("checks, then unchecks, saving each change", async () => {
    const qc = new QueryClient();
    const saved: string[] = [];
    const store = { put: async (c: EventCheck) => void saved.push(`put ${c.event_key} ${c.day}`), del: async (c: EventCheck) => void saved.push(`del ${c.event_key} ${c.day}`) };
    expect(await toggleEventCheck(qc, store, lunch, day, () => {}, NOW)).toBe(true);
    expect(qc.getQueryData<EventCheck[]>(EVENT_CHECKS_KEY)).toEqual([{ calendar_id: "c", event_key: "series", day: "2026-11-06", checked_at: iso(NOW) }]);
    expect(checkSet(qc.getQueryData(EVENT_CHECKS_KEY)).has(checkIdFor(lunch, day))).toBe(true);
    expect(await toggleEventCheck(qc, store, lunch, day, () => {}, NOW)).toBe(true);
    expect(qc.getQueryData(EVENT_CHECKS_KEY)).toEqual([]);
    expect(saved).toEqual(["put series 2026-11-06", "del series 2026-11-06"]);
  });
  it("rolls back and reports when the save fails", async () => {
    const qc = new QueryClient();
    const errors: string[] = [];
    const store = { put: async () => { throw new Error("relation event_checks does not exist"); }, del: async () => {} };
    expect(await toggleEventCheck(qc, store, lunch, day, (m) => errors.push(m))).toBe(false);
    expect(qc.getQueryData(EVENT_CHECKS_KEY)).toEqual([]);
    expect(errors[0]).toContain("event_checks");
  });
  it("another day is a separate check", async () => {
    const qc = new QueryClient();
    const store = { put: async () => {}, del: async () => {} };
    await toggleEventCheck(qc, store, lunch, day, () => {});
    await toggleEventCheck(qc, store, lunch, at(7), () => {});
    expect(qc.getQueryData<EventCheck[]>(EVENT_CHECKS_KEY)).toHaveLength(2);
  });
});

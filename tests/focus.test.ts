import { describe, expect, it } from "vitest";
import {
  actualVsEstimate,
  DEFAULT_FOCUS_PREFS,
  DEFAULT_POMODORO,
  elapsedMs,
  end,
  estimateMinutes,
  eventSoon,
  extend,
  focusTotals,
  formatClock,
  formatFocused,
  formatMinutes,
  formatOver,
  formatRemaining,
  hoursForMinutes,
  isOpen,
  isPaused,
  isTimeUp,
  newSession,
  nextPhase,
  nextTimedEvent,
  parseFocusPrefs,
  pause,
  pickableTasks,
  plannedFor,
  pomodorosInRun,
  remainingMs,
  resume,
  ringFraction,
  sanitizePomodoro,
  suggestTask,
  untilEventSeconds,
  upNextItems,
} from "@/lib/focus";
import { buildTodoList } from "@/lib/insights";
import { newTask } from "@/lib/tasks";
import type { FocusSession, GEvent, Task } from "@/lib/types";

// Fri Nov 6 2026, 12:00 (New York)
const NOW = new Date(2026, 10, 6, 12, 0).getTime();
const MIN = 60_000;
const at = (h: number, m = 0, day = 6) => new Date(2026, 10, day, h, m);
const iso = (d: Date | number) => new Date(d).toISOString();

const session = (over: Partial<FocusSession> = {}): FocusSession => ({
  id: "s1",
  task_id: "t1",
  kind: "work",
  mode: "stopwatch",
  planned_seconds: null,
  started_at: iso(NOW - 30 * MIN),
  paused_at: null,
  paused_ms: 0,
  ended_at: null,
  created_at: iso(NOW - 30 * MIN),
  ...over,
});

const task = (over: Partial<Task> & { title: string }): Task => newTask({ all_day: false, ...over });
const timedTask = (title: string, h: number, m = 0, over: Partial<Task> = {}) => task({ title, due_at: iso(at(h, m)), ...over });
const dateTask = (title: string, day: number, over: Partial<Task> = {}) => task({ title, due_at: iso(at(0, 0, day)), all_day: true, ...over });
const ev = (id: string, sh: number, sm: number, eh: number, over: Partial<GEvent> = {}): GEvent => ({
  id,
  calendar_id: "c",
  summary: id,
  description: "",
  start: iso(at(sh, sm)),
  end: iso(at(eh, sm)),
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

describe("elapsed time comes from timestamps", () => {
  it("counts up from started_at", () => {
    expect(elapsedMs(session(), NOW)).toBe(30 * MIN);
    expect(elapsedMs(session(), new Date(NOW))).toBe(30 * MIN);
  });
  it("survives a long sleep or reload: same answer however many ticks were missed", () => {
    const s = session();
    expect(elapsedMs(s, NOW + 3 * 3_600_000)).toBe(30 * MIN + 3 * 3_600_000);
  });
  it("subtracts paused_ms", () => {
    expect(elapsedMs(session({ paused_ms: 10 * MIN }), NOW)).toBe(20 * MIN);
  });
  it("freezes at paused_at while paused", () => {
    const s = session({ paused_at: iso(NOW - 5 * MIN) });
    expect(elapsedMs(s, NOW)).toBe(25 * MIN);
    expect(elapsedMs(s, NOW + 99 * MIN)).toBe(25 * MIN);
  });
  it("freezes at ended_at (ended_at wins over paused_at)", () => {
    const s = session({ ended_at: iso(NOW - 10 * MIN) });
    expect(elapsedMs(s, NOW + 5 * MIN)).toBe(20 * MIN);
  });
  it("is never negative (another device's clock is ahead)", () => {
    expect(elapsedMs(session({ started_at: iso(NOW + 5000) }), NOW)).toBe(0);
    expect(elapsedMs(session({ paused_ms: 99 * MIN }), NOW)).toBe(0);
  });
});

describe("remaining time and overtime", () => {
  it("is null for a stopwatch", () => {
    expect(remainingMs(session(), NOW)).toBeNull();
  });
  it("counts down a planned session", () => {
    const s = session({ mode: "countdown", planned_seconds: 45 * 60 });
    expect(remainingMs(s, NOW)).toBe(15 * MIN);
    expect(isTimeUp(s, NOW)).toBe(false);
  });
  it("goes negative as overtime and reports time up", () => {
    const s = session({ mode: "countdown", planned_seconds: 25 * 60 });
    expect(remainingMs(s, NOW)).toBe(-5 * MIN);
    expect(isTimeUp(s, NOW)).toBe(true);
  });
  it("time is up exactly at zero, but not for ended or stopwatch sessions", () => {
    expect(isTimeUp(session({ planned_seconds: 30 * 60 }), NOW)).toBe(true);
    expect(isTimeUp(session({ planned_seconds: 10 * 60, ended_at: iso(NOW) }), NOW)).toBe(false);
    expect(isTimeUp(session(), NOW)).toBe(false);
  });
  it("a pause stops the clock, so time isn't up while paused short of the target", () => {
    const s = session({ planned_seconds: 45 * 60, paused_at: iso(NOW - 20 * MIN) });
    expect(remainingMs(s, NOW + 60 * MIN)).toBe(35 * MIN);
  });
});

describe("pause / resume / end / extend", () => {
  it("pause stamps paused_at and is idempotent", () => {
    const s = session();
    const p = pause(s, NOW);
    expect(p.paused_at).toBe(iso(NOW));
    expect(isPaused(p)).toBe(true);
    expect(pause(p, NOW + MIN)).toBe(p);
    expect(s.paused_at).toBeNull(); // original untouched
  });
  it("resume adds the pause length to paused_ms and clears paused_at", () => {
    const p = pause(session(), NOW);
    const r = resume(p, NOW + 7 * MIN);
    expect(r.paused_at).toBeNull();
    expect(r.paused_ms).toBe(7 * MIN);
    expect(isPaused(r)).toBe(false);
    // elapsed didn't move across the pause
    expect(elapsedMs(r, NOW + 7 * MIN)).toBe(30 * MIN);
  });
  it("pause lengths accumulate over several pauses", () => {
    let s = session();
    s = pause(s, NOW);
    s = resume(s, NOW + 2 * MIN);
    s = pause(s, NOW + 12 * MIN);
    s = resume(s, NOW + 15 * MIN);
    expect(s.paused_ms).toBe(5 * MIN);
    expect(elapsedMs(s, NOW + 20 * MIN)).toBe(50 * MIN - 5 * MIN);
  });
  it("resume on a running session does nothing", () => {
    const s = session();
    expect(resume(s, NOW)).toBe(s);
  });
  it("resume never takes time away (clock skew)", () => {
    const p = pause(session(), NOW);
    expect(resume(p, NOW - 5 * MIN).paused_ms).toBe(0);
  });
  it("end stamps ended_at and closes the session", () => {
    const e = end(session(), NOW);
    expect(e.ended_at).toBe(iso(NOW));
    expect(isOpen(e)).toBe(false);
    expect(elapsedMs(e, NOW + 99 * MIN)).toBe(30 * MIN);
  });
  it("ending while paused doesn't count the pause as work", () => {
    const p = pause(session(), NOW - 10 * MIN);
    const e = end(p, NOW);
    expect(e.paused_at).toBeNull();
    expect(e.ended_at).toBe(iso(NOW));
    expect(elapsedMs(e, NOW)).toBe(20 * MIN);
  });
  it("end is idempotent", () => {
    const e = end(session(), NOW);
    expect(end(e, NOW + MIN)).toBe(e);
  });
  it("pause/resume/extend don't touch an ended session", () => {
    const e = end(session({ planned_seconds: 60 }), NOW);
    expect(pause(e, NOW)).toBe(e);
    expect(resume(e, NOW)).toBe(e);
  });
  it("extend adds seconds to a planned session only", () => {
    const s = session({ planned_seconds: 25 * 60 });
    expect(extend(s, 300).planned_seconds).toBe(30 * 60);
    expect(s.planned_seconds).toBe(25 * 60);
    const sw = session();
    expect(extend(sw, 300)).toBe(sw);
  });
  it("extend extends overtime back into positive time", () => {
    const s = session({ planned_seconds: 25 * 60 });
    expect(remainingMs(extend(s, 600), NOW)).toBe(5 * MIN);
  });
  it("newSession starts open, unpaused, with the given plan", () => {
    const s = newSession({ task_id: "t", mode: "countdown", planned_seconds: 900, now: NOW });
    expect(s).toMatchObject({ task_id: "t", kind: "work", mode: "countdown", planned_seconds: 900, paused_at: null, paused_ms: 0, ended_at: null, started_at: iso(NOW) });
    expect(s.id).toBeTruthy();
    expect(newSession({ task_id: null, kind: "break", mode: "countdown", now: NOW }).planned_seconds).toBeNull();
  });
});

describe("ring", () => {
  it("fills a planned session once and clamps at full in overtime", () => {
    expect(ringFraction(session({ planned_seconds: 60 * 60 }), NOW)).toBeCloseTo(0.5);
    expect(ringFraction(session({ planned_seconds: 10 * 60 }), NOW)).toBe(1);
  });
  it("a stopwatch laps every hour", () => {
    expect(ringFraction(session(), NOW)).toBeCloseTo(0.5);
    expect(ringFraction(session({ started_at: iso(NOW - 90 * MIN) }), NOW)).toBeCloseTo(0.5);
  });
});

describe("pomodoro cycling", () => {
  const P = DEFAULT_POMODORO;
  const work = (n: number, over: Partial<FocusSession> = {}): FocusSession =>
    session({ id: `w${n}`, mode: "pomodoro", planned_seconds: 25 * 60, started_at: iso(at(8 + n)), ended_at: iso(at(8 + n, 25)), ...over });
  const brk = (n: number, long = false): FocusSession =>
    session({ id: `b${n}`, kind: "break", mode: "pomodoro", planned_seconds: (long ? 15 : 5) * 60, started_at: iso(at(8 + n, 25)), ended_at: iso(at(8 + n, 40)) });

  it("work -> short break after the first three, long break after the fourth", () => {
    expect(nextPhase(work(0), P, 1)).toEqual({ kind: "break", seconds: 300, long: false });
    expect(nextPhase(work(0), P, 2)).toEqual({ kind: "break", seconds: 300, long: false });
    expect(nextPhase(work(0), P, 3)).toEqual({ kind: "break", seconds: 300, long: false });
    expect(nextPhase(work(0), P, 4)).toEqual({ kind: "break", seconds: 900, long: true });
    expect(nextPhase(work(0), P, 8)).toEqual({ kind: "break", seconds: 900, long: true });
  });
  it("any break is followed by a 25 minute work session", () => {
    expect(nextPhase(brk(0), P, 1)).toEqual({ kind: "work", seconds: 1500, long: false });
    expect(nextPhase(brk(0, true), P, 4)).toEqual({ kind: "work", seconds: 1500, long: false });
  });
  it("is configurable", () => {
    const c = { workMin: 50, shortMin: 10, longMin: 30, every: 2 };
    expect(nextPhase(brk(0), c, 1).seconds).toBe(3000);
    expect(nextPhase(work(0), c, 1)).toEqual({ kind: "break", seconds: 600, long: false });
    expect(nextPhase(work(0), c, 2)).toEqual({ kind: "break", seconds: 1800, long: true });
  });
  it("counts finished pomodoro work in the run today and resets after a long break", () => {
    const now = at(18);
    expect(pomodorosInRun([], P, now)).toBe(0);
    expect(pomodorosInRun([work(0)], P, now)).toBe(1);
    expect(pomodorosInRun([work(0), brk(0), work(1), brk(1), work(2)], P, now)).toBe(3);
    const full = [work(0), brk(0), work(1), brk(1), work(2), brk(2), work(3)];
    expect(pomodorosInRun(full, P, now)).toBe(4);
    expect(pomodorosInRun([...full, brk(3, true)], P, now)).toBe(0);
    expect(pomodorosInRun([...full, brk(3, true), work(4)], P, now)).toBe(1);
  });
  it("walks the whole cycle: 4 work sessions, the fourth followed by a long break", () => {
    const sessions: FocusSession[] = [];
    const phases: string[] = [];
    let cur = work(0);
    for (let i = 0; i < 4; i++) {
      sessions.push(cur);
      const ph = nextPhase(cur, P, pomodorosInRun(sessions, P, at(20)));
      phases.push(`${ph.kind}${ph.long ? "-long" : ""}`);
      const b = brk(i + 1, ph.long);
      sessions.push(b);
      cur = work(i + 1);
    }
    expect(phases).toEqual(["break", "break", "break", "break-long"]);
  });
  it("ignores yesterday's sessions, other modes and unfinished work", () => {
    const now = at(18);
    const yesterday = work(0, { ended_at: iso(at(10, 0, 5)), started_at: iso(at(9, 30, 5)) });
    const sw = work(1, { mode: "stopwatch" });
    const open = work(2, { ended_at: null });
    expect(pomodorosInRun([yesterday, sw, open], P, now)).toBe(0);
  });
  it("sanitizes settings", () => {
    expect(sanitizePomodoro(undefined)).toEqual(DEFAULT_POMODORO);
    expect(sanitizePomodoro({ workMin: -4, shortMin: 999, longMin: 12.6, every: 1 })).toEqual({ workMin: 1, shortMin: 60, longMin: 13, every: 2 });
  });
});

describe("until next event", () => {
  const NOON = at(12);
  it("counts to the next timed event minus the buffer", () => {
    expect(untilEventSeconds([ev("a", 13, 0, 14)], NOON)).toBe(55 * 60);
    expect(untilEventSeconds([ev("a", 13, 0, 14)], NOON, 0)).toBe(60 * 60);
    expect(untilEventSeconds([ev("a", 13, 0, 14)], NOON, 15)).toBe(45 * 60);
  });
  it("uses the soonest event, skipping ones that already started and all-day ones", () => {
    const events = [ev("late", 17, 0, 18), ev("soon", 14, 0, 15), ev("past", 9, 0, 10), ev("allday", 0, 0, 0, { all_day: true, start: "2026-11-06", end: "2026-11-07" })];
    expect(untilEventSeconds(events, NOON)).toBe(115 * 60);
    expect(nextTimedEvent(events, NOON)?.event.id).toBe("soon");
  });
  it("is null with no events, only past events, tomorrow's events, or inside the buffer", () => {
    expect(untilEventSeconds([], NOON)).toBeNull();
    expect(untilEventSeconds([ev("past", 9, 0, 10)], NOON)).toBeNull();
    expect(untilEventSeconds([ev("tmrw", 9, 0, 10, { start: iso(at(9, 0, 7)), end: iso(at(10, 0, 7)) })], NOON)).toBeNull();
    expect(untilEventSeconds([ev("now", 12, 3, 13)], NOON)).toBeNull();
  });
  it("eventSoon reports minutes only within the window", () => {
    expect(eventSoon([ev("HOSA call", 12, 38, 13)], NOON)).toMatchObject({ minutes: 38 });
    expect(eventSoon([ev("HOSA call", 12, 38, 13)], NOON)?.event.summary).toBe("HOSA call");
    expect(eventSoon([ev("later", 14, 0, 15)], NOON)).toBeNull();
    expect(eventSoon([ev("later", 14, 0, 15)], NOON, 180)).toMatchObject({ minutes: 120 });
    expect(eventSoon([], NOON)).toBeNull();
  });
});

describe("suggesting what to work on", () => {
  const now = at(12);
  const todoOf = (tasks: Task[], events: GEvent[] = []) => buildTodoList(tasks, events, new Set(), now);
  it("prefers the oldest overdue task", () => {
    const tasks = [timedTask("Anki", 21), dateTask("Old", 2), dateTask("Yesterday", 5), timedTask("Late", 9)];
    expect(suggestTask(tasks, todoOf(tasks), now)?.title).toBe("Old");
  });
  it("then today's soonest timed task, before date-only ones", () => {
    const tasks = [dateTask("HW", 6), timedTask("Anki", 21), timedTask("Lab", 15)];
    expect(suggestTask(tasks, todoOf(tasks), now)?.title).toBe("Lab");
    const onlyDate = [dateTask("HW", 6)];
    expect(suggestTask(onlyDate, todoOf(onlyDate), now)?.title).toBe("HW");
  });
  it("skips done tasks and events", () => {
    const tasks = [timedTask("Done", 13, 0, { completed_at: iso(at(11)) }), timedTask("Open", 18)];
    const events = [ev("Lunch", 12, 30, 13, { todo: true })];
    expect(suggestTask(tasks, todoOf(tasks, events), now)?.title).toBe("Open");
  });
  it("falls back to starred or flagged tasks (both first, then starred, then flagged)", () => {
    const tasks = [task({ title: "Plain" }), task({ title: "Flag", flagged: true }), task({ title: "Star", starred: true }), task({ title: "Both", starred: true, flagged: true })];
    expect(suggestTask(tasks, todoOf(tasks), now)?.title).toBe("Both");
    expect(suggestTask(tasks.slice(0, 3), todoOf(tasks), now)?.title).toBe("Star");
    expect(suggestTask([tasks[0], tasks[1]], [], now)?.title).toBe("Flag");
  });
  it("ignores completed starred tasks and is null when nothing qualifies", () => {
    const tasks = [task({ title: "Plain" }), task({ title: "Star done", starred: true, completed_at: iso(at(9)) })];
    expect(suggestTask(tasks, todoOf(tasks), now)).toBeNull();
    expect(suggestTask([], [], now)).toBeNull();
  });
  it("up next skips the current task and done items, and caps the list", () => {
    const tasks = [timedTask("A", 13), timedTask("B", 14), timedTask("C", 15), timedTask("D", 16), timedTask("Done", 12, 30, { completed_at: iso(at(12)) })];
    const todo = todoOf(tasks);
    expect(upNextItems(todo, tasks[0].id).map((i) => i.title)).toEqual(["B", "C", "D"]);
    expect(upNextItems(todo, null, 2).map((i) => i.title)).toEqual(["A", "B"]);
    expect(upNextItems(todo, null, 10).map((i) => i.title)).toEqual(["A", "B", "C", "D"]);
  });
  it("pickableTasks lists open tasks in to-do order", () => {
    const tasks = [timedTask("B", 14), timedTask("A", 13), timedTask("Done", 12, 30, { completed_at: iso(at(12)) })];
    expect(pickableTasks(todoOf(tasks, [ev("E", 12, 40, 13, { todo: true })])).map((t) => t.title)).toEqual(["A", "B"]);
  });
  it("estimates minutes from a task's takes or an event's length", () => {
    const t = timedTask("A", 13, 0, { duration_minutes: 45 });
    const items = todoOf([t, timedTask("B", 14)], [ev("E", 15, 0, 16, { todo: true })]);
    expect(items.map(estimateMinutes)).toEqual([45, 30, 60]);
    const allDay = buildTodoList([], [ev("AD", 0, 0, 0, { all_day: true, todo: true, start: "2026-11-06", end: "2026-11-07" })], new Set(), now);
    expect(estimateMinutes(allDay[0])).toBeNull();
  });
});

describe("daily totals", () => {
  const w = (id: string, startMin: number, lenMin: number, over: Partial<FocusSession> = {}) =>
    session({ id, started_at: iso(at(9, startMin)), ended_at: iso(at(9, startMin + lenMin)), ...over });
  it("sums today's work and counts finished sessions", () => {
    const sessions = [w("a", 0, 25), w("b", 30, 20)];
    expect(focusTotals(sessions, at(12))).toEqual({ workMs: 45 * MIN, completed: 2 });
  });
  it("leaves out breaks and other days", () => {
    const sessions = [w("a", 0, 25), w("br", 25, 5, { kind: "break" }), w("old", 0, 40, { started_at: iso(at(9, 0, 5)), ended_at: iso(at(9, 40, 5)) })];
    expect(focusTotals(sessions, at(12))).toEqual({ workMs: 25 * MIN, completed: 1 });
  });
  it("counts an open session's time so far but not as completed", () => {
    const open = session({ started_at: iso(at(11, 40)), id: "o" });
    expect(focusTotals([w("a", 0, 25), open], at(12))).toEqual({ workMs: 45 * MIN, completed: 1 });
  });
  it("pauses don't count, and a sub-minute session earns no dot", () => {
    const paused = w("p", 0, 30, { paused_ms: 10 * MIN });
    const blip = session({ id: "blip", started_at: iso(at(10, 0)), ended_at: iso(at(10, 0) .getTime() + 20_000) });
    expect(focusTotals([paused, blip], at(12))).toEqual({ workMs: 20 * MIN + 20_000, completed: 1 });
  });
  it("is zero with no sessions", () => {
    expect(focusTotals([], at(12))).toEqual({ workMs: 0, completed: 0 });
  });
  it("actual vs estimate sums every work session for the task", () => {
    const t = task({ title: "Lab", duration_minutes: 40 });
    const sessions = [
      w("a", 0, 30, { task_id: t.id }),
      w("b", 40, 22, { task_id: t.id, started_at: iso(at(9, 40, 4)), ended_at: iso(at(10, 2, 4)) }),
      w("other", 0, 50, { task_id: "zzz" }),
      w("brk", 0, 5, { task_id: t.id, kind: "break" }),
    ];
    expect(actualVsEstimate(sessions, t, at(12))).toEqual({ actualMin: 52, estimateMin: 40 });
  });
  it("actual vs estimate defaults the estimate to 30 and includes an open session", () => {
    const t = task({ title: "Read" });
    const open = session({ task_id: t.id, started_at: iso(at(11, 50)) });
    expect(actualVsEstimate([open], t, at(12))).toEqual({ actualMin: 10, estimateMin: 30 });
    expect(actualVsEstimate([], t, at(12))).toEqual({ actualMin: 0, estimateMin: 30 });
  });
});

describe("formatting", () => {
  it("formats the clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(18 * MIN + 24_000)).toBe("18:24");
    expect(formatClock(3_600_000 + 2 * MIN + 11_000)).toBe("1:02:11");
    expect(formatClock(-5000)).toBe("00:00");
    expect(formatClock(59_999)).toBe("00:59");
  });
  it("shows a countdown rounded up so it doesn't hit 00:00 early", () => {
    expect(formatRemaining(25 * MIN)).toBe("25:00");
    expect(formatRemaining(24 * MIN + 59_001)).toBe("25:00");
    expect(formatRemaining(1)).toBe("00:01");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(-3000)).toBe("00:00");
  });
  it("formats overtime", () => {
    expect(formatOver(3 * MIN + 10_000)).toBe("+03:10 over");
    expect(formatOver(0)).toBe("+00:00 over");
  });
  it("formats minutes and focused totals", () => {
    expect(formatMinutes(52)).toBe("52 min");
    expect(formatMinutes(112)).toBe("1h 52m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatFocused(112 * MIN)).toBe("1h 52m");
    expect(formatFocused(45 * MIN + 59_000)).toBe("45m");
    expect(formatFocused(0)).toBe("0m");
    expect(formatFocused(2 * 3_600_000)).toBe("2h");
  });
  it("converts minutes to loggable hours", () => {
    expect(hoursForMinutes(52)).toBe(0.9);
    expect(hoursForMinutes(90)).toBe(1.5);
    expect(hoursForMinutes(1)).toBe(0.1);
    expect(hoursForMinutes(0)).toBe(0.1);
  });
});

describe("remembered mode", () => {
  it("falls back to defaults on nothing or junk", () => {
    expect(parseFocusPrefs(null)).toEqual(DEFAULT_FOCUS_PREFS);
    expect(parseFocusPrefs("{nope")).toEqual(DEFAULT_FOCUS_PREFS);
    expect(parseFocusPrefs(JSON.stringify({ mode: "zzz", countdown: "x", alerts: 3, dim: "yes" }))).toEqual({ ...DEFAULT_FOCUS_PREFS, countdown: 25 });
  });
  it("round-trips a saved choice", () => {
    const saved = { mode: "pomodoro", countdown: "estimate", pomodoro: { workMin: 50, shortMin: 10, longMin: 30, every: 3 }, alerts: false, dim: true };
    expect(parseFocusPrefs(JSON.stringify(saved))).toEqual(saved);
    expect(parseFocusPrefs(JSON.stringify({ mode: "countdown", countdown: 45 })).countdown).toBe(45);
  });
  it("plans the session for the chosen mode", () => {
    const base = DEFAULT_FOCUS_PREFS;
    const t = task({ title: "A", duration_minutes: 40 });
    expect(plannedFor(base, t, null)).toEqual({ mode: "stopwatch", seconds: null });
    expect(plannedFor({ ...base, mode: "countdown", countdown: 45 }, t, null)).toEqual({ mode: "countdown", seconds: 2700 });
    expect(plannedFor({ ...base, mode: "countdown", countdown: "estimate" }, t, null)).toEqual({ mode: "countdown", seconds: 2400 });
    expect(plannedFor({ ...base, mode: "countdown", countdown: "estimate" }, null, null)).toEqual({ mode: "countdown", seconds: 1500 });
    expect(plannedFor({ ...base, mode: "pomodoro" }, t, null)).toEqual({ mode: "pomodoro", seconds: 1500 });
    expect(plannedFor({ ...base, mode: "until_event" }, t, 3300)).toEqual({ mode: "until_event", seconds: 3300 });
    expect(plannedFor({ ...base, mode: "until_event" }, t, null)).toEqual({ mode: "stopwatch", seconds: null });
  });
});

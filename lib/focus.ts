import { eventRange } from "./agenda";
import { startOfDay, uid } from "./dates";
import type { TodoItem } from "./insights";
import { takesMinutes } from "./timeline";
import type { FocusMode, FocusSession, GEvent, Task } from "./types";

/** Every function takes `now` as a Date or epoch milliseconds, so tests can pin the clock. */
export type Now = Date | number;
const ms = (n: Now) => (typeof n === "number" ? n : n.getTime());
const stamp = (n: Now) => new Date(ms(n)).toISOString();
const at = (iso: string) => new Date(iso).getTime();

// ------------------------------------------------------------------ session math

export const isOpen = (s: Pick<FocusSession, "ended_at">) => s.ended_at == null;
export const isPaused = (s: Pick<FocusSession, "ended_at" | "paused_at">) => s.ended_at == null && s.paused_at != null;

/**
 * Time actually spent, in ms: (ended_at ?? paused_at ?? now) - started_at - paused_ms. Computed from timestamps only,
 * so a reload, a sleeping laptop or another device all agree. Never negative (clock skew between devices).
 */
export function elapsedMs(s: FocusSession, now: Now): number {
  const end = s.ended_at ? at(s.ended_at) : s.paused_at ? at(s.paused_at) : ms(now);
  return Math.max(0, end - at(s.started_at) - s.paused_ms);
}

/** Time left on a planned session in ms; negative once it runs over. null for a stopwatch (nothing planned). */
export function remainingMs(s: FocusSession, now: Now): number | null {
  return s.planned_seconds == null ? null : s.planned_seconds * 1000 - elapsedMs(s, now);
}

export function pause(s: FocusSession, now: Now): FocusSession {
  return isOpen(s) && !s.paused_at ? { ...s, paused_at: stamp(now) } : s;
}

/** Adds the length of the pause to paused_ms, so the clock carries on from where it stopped. */
export function resume(s: FocusSession, now: Now): FocusSession {
  if (!isOpen(s) || !s.paused_at) return s;
  const gap = Math.max(0, ms(now) - at(s.paused_at));
  return { ...s, paused_at: null, paused_ms: s.paused_ms + gap };
}

/** Ends the session. Ending while paused doesn't count the pause as work. */
export function end(s: FocusSession, now: Now): FocusSession {
  if (!isOpen(s)) return s;
  const r = resume(s, now);
  return { ...r, ended_at: stamp(now) };
}

/** Adds time to a planned session (a stopwatch has no target, so it is left alone). */
export function extend(s: FocusSession, seconds: number): FocusSession {
  return s.planned_seconds == null ? s : { ...s, planned_seconds: Math.max(1, s.planned_seconds + Math.round(seconds)) };
}

export function newSession(p: {
  task_id: string | null;
  kind?: FocusSession["kind"];
  mode: FocusMode;
  planned_seconds?: number | null;
  now: Now;
}): FocusSession {
  return {
    id: uid(),
    task_id: p.task_id,
    kind: p.kind ?? "work",
    mode: p.mode,
    planned_seconds: p.planned_seconds ?? null,
    started_at: stamp(p.now),
    paused_at: null,
    paused_ms: 0,
    ended_at: null,
    created_at: stamp(p.now),
  };
}

/** Fraction of the ring to draw (0..1). A planned session fills once; a stopwatch laps every hour. */
export function ringFraction(s: FocusSession, now: Now): number {
  const e = elapsedMs(s, now);
  if (s.planned_seconds) return Math.min(1, e / (s.planned_seconds * 1000));
  return (e % 3_600_000) / 3_600_000;
}

/** A planned session whose time is up (it keeps running as "overtime" until the user moves on). */
export function isTimeUp(s: FocusSession, now: Now): boolean {
  const r = remainingMs(s, now);
  return isOpen(s) && r != null && r <= 0;
}

// ------------------------------------------------------------------ pomodoro

export interface PomodoroSettings {
  workMin: number;
  shortMin: number;
  longMin: number;
  /** A long break after this many work sessions in a row. */
  every: number;
}

export const DEFAULT_POMODORO: PomodoroSettings = { workMin: 25, shortMin: 5, longMin: 15, every: 4 };

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

export function sanitizePomodoro(p: Partial<PomodoroSettings> | null | undefined): PomodoroSettings {
  return {
    workMin: clampInt(p?.workMin, 1, 180, DEFAULT_POMODORO.workMin),
    shortMin: clampInt(p?.shortMin, 1, 60, DEFAULT_POMODORO.shortMin),
    longMin: clampInt(p?.longMin, 1, 90, DEFAULT_POMODORO.longMin),
    every: clampInt(p?.every, 2, 12, DEFAULT_POMODORO.every),
  };
}

const sameDay = (iso: string, now: Now) => +startOfDay(new Date(iso)) === +startOfDay(new Date(ms(now)));
const isLongBreak = (s: FocusSession, p: PomodoroSettings) => s.kind === "break" && (s.planned_seconds ?? 0) >= p.longMin * 60 && p.longMin > p.shortMin;

/**
 * Work pomodoros finished in the current run: today's ended pomodoro work sessions after the latest long break.
 * A long break resets the run, so the count goes 1, 2, 3, 4 and then starts over.
 */
export function pomodorosInRun(sessions: FocusSession[], p: PomodoroSettings, now: Now): number {
  const today = sessions
    .filter((s) => s.mode === "pomodoro" && s.ended_at && sameDay(s.ended_at, now))
    .sort((a, b) => at(a.ended_at!) - at(b.ended_at!));
  let n = 0;
  for (const s of today) {
    if (isLongBreak(s, p)) n = 0;
    else if (s.kind === "work") n += 1;
  }
  return n;
}

export interface Phase {
  kind: "work" | "break";
  seconds: number;
  /** A long break (so the label can say so). */
  long: boolean;
}

/**
 * What follows `prev` in a pomodoro run: after work, a short break, or a long one after every `settings.every` work
 * sessions; after any break, work. `inRun` counts the finished work sessions of the run INCLUDING `prev` (see pomodorosInRun).
 */
export function nextPhase(prev: FocusSession, settings: PomodoroSettings, inRun: number): Phase {
  if (prev.kind === "break") return { kind: "work", seconds: settings.workMin * 60, long: false };
  const long = inRun > 0 && inRun % settings.every === 0;
  return { kind: "break", seconds: (long ? settings.longMin : settings.shortMin) * 60, long };
}

// ------------------------------------------------------------------ events

/** The next timed (not all-day) event that hasn't started yet, today only. */
export function nextTimedEvent(events: GEvent[], now: Now): { event: GEvent; start: Date } | null {
  const t = ms(now);
  const eod = +startOfDay(new Date(t)) + 24 * 3_600_000;
  let best: { event: GEvent; start: Date } | null = null;
  for (const event of events) {
    if (event.all_day) continue;
    const start = eventRange(event).start;
    if (+start <= t || +start >= eod) continue;
    if (!best || +start < +best.start) best = { event, start };
  }
  return best;
}

/**
 * Seconds from now until `bufferMin` minutes before the next timed event today, or null when there is no such event
 * or it is already inside the buffer (nothing useful left to count down to).
 */
export function untilEventSeconds(events: GEvent[], now: Now, bufferMin = 5): number | null {
  const next = nextTimedEvent(events, now);
  if (!next) return null;
  const s = Math.floor((+next.start - bufferMin * 60_000 - ms(now)) / 1000);
  return s > 0 ? s : null;
}

/** An event starting within `withinMin` minutes (for the "HOSA call in 38 min" row), or null. */
export function eventSoon(events: GEvent[], now: Now, withinMin = 60): { event: GEvent; minutes: number } | null {
  const next = nextTimedEvent(events, now);
  if (!next) return null;
  const minutes = Math.ceil((+next.start - ms(now)) / 60_000);
  return minutes <= withinMin ? { event: next.event, minutes } : null;
}

// ------------------------------------------------------------------ what to work on

/**
 * What to focus on when nothing is chosen: the oldest overdue task, then today's soonest (timed before date-only),
 * then a starred or flagged open task (both beats one; earliest due first). null when there's nothing.
 */
export function suggestTask(tasks: Task[], todo: TodoItem[], now: Now): Task | null {
  void now;
  const open = todo.filter((i) => i.kind === "task" && i.task && !i.done && !i.task.completed_at);
  const overdue = open.find((i) => i.overdue);
  if (overdue) return overdue.task!;
  // buildTodoList already orders timed items by time, then date-only ones
  if (open[0]) return open[0].task!;
  const weight = (t: Task) => (t.starred ? 2 : 0) + (t.flagged ? 1 : 0);
  const marked = tasks
    .filter((t) => !t.completed_at && (t.starred || t.flagged))
    .sort((a, b) => weight(b) - weight(a) || (a.due_at ?? "9").localeCompare(b.due_at ?? "9") || a.title.localeCompare(b.title));
  return marked[0] ?? null;
}

/** The next `n` open items on today's list, skipping the task being worked on. */
export function upNextItems(todo: TodoItem[], currentTaskId: string | null, n = 3): TodoItem[] {
  return todo.filter((i) => !i.done && !(i.task && i.task.id === currentTaskId)).slice(0, n);
}

/** Open tasks on today's list, for the "pick something" list (the first one is the suggestion). */
export const pickableTasks = (todo: TodoItem[]): Task[] => todo.filter((i) => i.kind === "task" && i.task && !i.done && !i.task.completed_at).map((i) => i.task!);

/** How long an item is expected to take, in minutes: a task's estimate, or an event's length. */
export function estimateMinutes(item: TodoItem): number | null {
  if (item.task) return takesMinutes(item.task);
  if (item.event && !item.event.all_day) {
    const r = eventRange(item.event);
    return Math.max(1, Math.round((+r.end - +r.start) / 60_000));
  }
  return null;
}

// ------------------------------------------------------------------ totals

const MIN_COUNTED_MS = 60_000;

/**
 * Today's work: total ms (an open session counts up to now) and how many work sessions were finished.
 * A session shorter than a minute is an accidental tap and doesn't earn a dot.
 */
export function focusTotals(sessions: FocusSession[], now: Now): { workMs: number; completed: number } {
  let workMs = 0;
  let completed = 0;
  for (const s of sessions) {
    if (s.kind !== "work" || !sameDay(s.started_at, now)) continue;
    const e = elapsedMs(s, now);
    workMs += e;
    if (s.ended_at && e >= MIN_COUNTED_MS) completed += 1;
  }
  return { workMs, completed };
}

/** Minutes really spent on a task (all work sessions, ever) against its estimate. */
export function actualVsEstimate(sessions: FocusSession[], task: Pick<Task, "id" | "duration_minutes">, now: Now = Date.now()): { actualMin: number; estimateMin: number } {
  const total = sessions.filter((s) => s.kind === "work" && s.task_id === task.id).reduce((sum, s) => sum + elapsedMs(s, now), 0);
  return { actualMin: Math.round(total / 60_000), estimateMin: takesMinutes(task) };
}

/** Hours to log for `minutes` of work: one decimal, never below 0.1. */
export const hoursForMinutes = (minutes: number): number => Math.max(0.1, Math.round((minutes / 60) * 10) / 10);

// ------------------------------------------------------------------ formatting

const pad = (n: number) => String(n).padStart(2, "0");

/** 18:24, or 1:02:11 from an hour up. Rounds down, so a countdown never shows 0:00 early. */
export function formatClock(milliseconds: number): string {
  const s = Math.floor(Math.max(0, milliseconds) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** What a countdown shows: time left, rounded UP to the second (25:00 until the first second passes). */
export const formatRemaining = (remaining: number): string => formatClock(Math.ceil(Math.max(0, remaining) / 1000) * 1000);

/** "+3:10 over" for overtime (ms past zero). */
export const formatOver = (over: number): string => `+${formatClock(over)} over`;

/** 52 -> "52 min", 112 -> "1h 52m", 120 -> "2h". */
export function formatMinutes(min: number): string {
  const m = Math.round(Math.max(0, min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** "1h 52m focused" style total; under a minute reads "0m". */
export function formatFocused(workMs: number): string {
  const m = Math.floor(workMs / 60_000);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}

// ------------------------------------------------------------------ remembered settings

export type CountdownChoice = "estimate" | number;

export interface FocusPrefs {
  mode: FocusMode;
  /** Countdown length: minutes, or "estimate" for the task's own estimate. */
  countdown: CountdownChoice;
  pomodoro: PomodoroSettings;
  /** Chime + notification when a timer ends. */
  alerts: boolean;
  /** Low-contrast clock for late nights. */
  dim: boolean;
}

export const FOCUS_PREFS_KEY = "sd-focus";
export const COUNTDOWN_PRESETS = [15, 25, 45, 60] as const;
export const DEFAULT_FOCUS_PREFS: FocusPrefs = { mode: "stopwatch", countdown: 25, pomodoro: DEFAULT_POMODORO, alerts: true, dim: false };

const MODES: FocusMode[] = ["stopwatch", "countdown", "pomodoro", "until_event"];

export function parseFocusPrefs(raw: string | null | undefined): FocusPrefs {
  try {
    const p = (raw ? JSON.parse(raw) : {}) as Partial<Record<keyof FocusPrefs, unknown>>;
    return {
      mode: MODES.includes(p.mode as FocusMode) ? (p.mode as FocusMode) : DEFAULT_FOCUS_PREFS.mode,
      countdown: p.countdown === "estimate" ? "estimate" : clampInt(p.countdown, 1, 600, 25),
      pomodoro: sanitizePomodoro(p.pomodoro as Partial<PomodoroSettings> | undefined),
      alerts: typeof p.alerts === "boolean" ? p.alerts : DEFAULT_FOCUS_PREFS.alerts,
      dim: p.dim === true,
    };
  } catch {
    return DEFAULT_FOCUS_PREFS;
  }
}

/** The session to start for the chosen mode. `eventSeconds` is the until-event target (null = none to count to). */
export function plannedFor(prefs: FocusPrefs, task: Pick<Task, "duration_minutes"> | null, eventSeconds: number | null): { mode: FocusMode; seconds: number | null } {
  switch (prefs.mode) {
    case "countdown":
      return { mode: "countdown", seconds: (prefs.countdown === "estimate" ? (task ? takesMinutes(task) : 25) : prefs.countdown) * 60 };
    case "pomodoro":
      return { mode: "pomodoro", seconds: prefs.pomodoro.workMin * 60 };
    case "until_event":
      return eventSeconds ? { mode: "until_event", seconds: eventSeconds } : { mode: "stopwatch", seconds: null };
    default:
      return { mode: "stopwatch", seconds: null };
  }
}

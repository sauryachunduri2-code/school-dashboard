import type { SettingsRow, Task, TaskReminder } from "./types";

export interface ReminderSend {
  task_id: string;
  remind_at: string;
}

/** What the reminder maths needs from the settings row. */
export type ReminderSettings = Pick<SettingsRow, "default_remind_offset" | "allday_remind_minutes">;

/** Default reminder: at the due time. All-day tasks remind at 8:00 AM on the due day. */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { default_remind_offset: 0, allday_remind_minutes: 480 };
export const DEFAULT_SETTINGS_ROW: SettingsRow = { id: 1, ...DEFAULT_REMINDER_SETTINGS };

/** Ignore reminders that are far in the past (e.g. app was down) so nothing arrives a day late. */
export const MAX_AGE_MS = 6 * 3600 * 1000;
/** A reminder time that had already passed (by more than this) when the task was last saved never fires. */
export const PAST_GRACE_MS = 5 * 60 * 1000;
/** Longest "before due" offset we accept (30 days). Bounds the cron's candidate query. */
export const MAX_OFFSET_MIN = 30 * 1440;

/** Choices for the default reminder in Settings (null = none). */
export const DEFAULT_OFFSET_CHOICES: { value: number | null; label: string }[] = [
  { value: null, label: "None" },
  { value: 0, label: "At due time" },
  { value: 5, label: "5 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

/** Choices for a custom "before due" reminder in the task editor. */
export const CUSTOM_OFFSET_CHOICES: number[] = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080];

export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "At due time";
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} before`;
  if (minutes % 10080 === 0) return unit(minutes / 10080, "week");
  if (minutes % 1440 === 0) return unit(minutes / 1440, "day");
  if (minutes % 60 === 0) return unit(minutes / 60, "hour");
  return `${minutes} min before`;
}

export function computeRemindAt(due: Date, offsetMinutes: number): Date {
  return new Date(+due - offsetMinutes * 60000);
}

/**
 * The moment offsets count back from. Timed tasks: the due time. All-day tasks: the configured
 * time on the due day. `due_at` of an all-day task is local midnight, so adding minutes keeps this
 * identical on every device and in the cron (which has no timezone). Off by an hour only on the
 * two DST-change days a year.
 */
export function reminderBase(due: Date, allDay: boolean, settings: ReminderSettings): Date {
  return allDay ? new Date(+due + settings.allday_remind_minutes * 60000) : due;
}

const validDate = (s: unknown): Date | null => {
  if (typeof s !== "string") return null;
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d;
};

/** Settings from a possibly-missing / malformed row. */
export function sanitizeSettings(raw: unknown): ReminderSettings {
  const r = (raw ?? {}) as Partial<Record<keyof ReminderSettings, unknown>>;
  const off = r.default_remind_offset;
  const day = r.allday_remind_minutes;
  return {
    default_remind_offset:
      off === null ? null : typeof off === "number" && Number.isInteger(off) && off >= 0 && off <= MAX_OFFSET_MIN ? off : DEFAULT_REMINDER_SETTINGS.default_remind_offset,
    allday_remind_minutes:
      typeof day === "number" && Number.isInteger(day) && day >= 0 && day < 1440 ? day : DEFAULT_REMINDER_SETTINGS.allday_remind_minutes,
  };
}

/** Custom reminders from a possibly-malformed value (jsonb from the DB, old cached rows). Drops invalid and duplicate entries. */
export function sanitizeReminders(raw: unknown): TaskReminder[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TaskReminder[] = [];
  for (const item of raw) {
    let r: TaskReminder | null = null;
    const o = item as { kind?: unknown; minutes?: unknown; at?: unknown } | null;
    if (o?.kind === "offset" && typeof o.minutes === "number" && Number.isInteger(o.minutes) && o.minutes >= 0 && o.minutes <= MAX_OFFSET_MIN) {
      r = { kind: "offset", minutes: o.minutes };
    } else if (o?.kind === "at") {
      const d = validDate(o.at);
      if (d) r = { kind: "at", at: d.toISOString() };
    }
    if (!r) continue;
    const key = r.kind === "offset" ? `o${r.minutes}` : `a${r.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export interface FireTime {
  at: Date;
  source: "default" | "custom";
}

/**
 * Every moment a task should remind, sorted, one entry per distinct instant (the default and a
 * custom reminder landing on the same time are one reminder). Offsets need a due date; exact times don't.
 */
export function taskFireTimes(task: Task, settings: ReminderSettings): FireTime[] {
  const out = new Map<number, FireTime>();
  const add = (at: Date, source: FireTime["source"]) => {
    if (!Number.isNaN(+at) && !out.has(+at)) out.set(+at, { at, source });
  };
  const due = validDate(task.due_at);
  if (due) {
    const base = reminderBase(due, task.all_day, settings);
    if (task.remind_default !== false && settings.default_remind_offset != null) add(computeRemindAt(base, settings.default_remind_offset), "default");
    for (const r of sanitizeReminders(task.reminders)) if (r.kind === "offset") add(computeRemindAt(base, r.minutes), "custom");
  }
  for (const r of sanitizeReminders(task.reminders)) if (r.kind === "at") add(new Date(r.at), "custom");
  return [...out.values()].sort((a, b) => +a.at - +b.at);
}

/** What a repeating task's next occurrence inherits: the default toggle and the relative reminders. Exact times don't carry over. */
export function carryReminders(task: Pick<Task, "remind_default" | "reminders">): Pick<Task, "remind_default" | "reminders"> {
  return {
    remind_default: task.remind_default !== false,
    reminders: sanitizeReminders(task.reminders).filter((r) => r.kind === "offset"),
  };
}

/**
 * Range of due dates that can have a reminder inside the last MAX_AGE_MS. Offsets reach back at most
 * MAX_OFFSET_MIN, and the all-day time adds up to a day after the (midnight) due time.
 */
export function candidateWindow(now: Date, maxAgeMs = MAX_AGE_MS): { dueFrom: Date; dueTo: Date } {
  return {
    dueFrom: new Date(+now - maxAgeMs - 1440 * 60000),
    dueTo: new Date(+now + MAX_OFFSET_MIN * 60000),
  };
}

export interface DueReminder {
  task: Task;
  /** Every unsent fire time of this task that is due now. Usually one; several after an outage. */
  fireAts: Date[];
}

/**
 * Reminder instances to send now. Each (task, fire time) is its own instance: it is due once its
 * time has passed, the task is open, it isn't stale, wasn't set in the past, and hasn't been sent.
 * Editing a due time only changes which instances exist; instances already sent stay sent.
 */
export function selectDueReminders(
  tasks: Task[],
  sends: ReminderSend[],
  now: Date,
  settings: ReminderSettings = DEFAULT_REMINDER_SETTINGS,
  maxAgeMs = MAX_AGE_MS,
): DueReminder[] {
  const sent = new Set(sends.map((s) => `${s.task_id}|${new Date(s.remind_at).toISOString()}`));
  const out: DueReminder[] = [];
  for (const task of tasks) {
    if (task.completed_at) continue;
    const saved = validDate(task.updated_at);
    const fireAts = taskFireTimes(task, settings)
      .map((f) => f.at)
      .filter((at) => {
        if (+at > +now || +now - +at > maxAgeMs) return false;
        if (saved && +at < +saved - PAST_GRACE_MS) return false;
        return !sent.has(`${task.id}|${at.toISOString()}`);
      });
    if (fireAts.length) out.push({ task, fireAts });
  }
  return out;
}

/** The service worker formats the time in the device's own timezone. */
export function reminderPayload(task: Task, listName?: string | null) {
  return {
    title: task.title,
    listName: listName ?? null,
    due_at: task.due_at,
    all_day: task.all_day,
    tag: task.id,
    url: "/",
  };
}

/**
 * Bring a task row from before 0004 (remind_at / remind_offset) to the current shape. Mirrors the
 * data migration in supabase/migrations/0004_reminders.sql; used by the dev-only IndexedDB mode and
 * for stale cached rows. Rows already in the new shape come back unchanged.
 */
export function normalizeTask(raw: Task, now = new Date()): Task {
  const row = raw as Task & { remind_at?: string | null; remind_offset?: number | null };
  if (Array.isArray(row.reminders) && typeof row.remind_default === "boolean") return row;

  const { remind_at, remind_offset, ...rest } = row;
  let reminders: TaskReminder[] = [];
  let remind_default = true;
  const at = validDate(remind_at);
  if (at) {
    // Timed tasks keep their offset; all-day ones keep the exact old time (the all-day base moved from 9 to 8 AM).
    reminders = remind_offset != null && row.due_at && !row.all_day ? [{ kind: "offset", minutes: remind_offset }] : [{ kind: "at", at: at.toISOString() }];
    remind_default = false;
  } else if (row.completed_at || (row.due_at && +new Date(row.due_at) < +now)) {
    remind_default = false;
  }
  return { ...rest, remind_default, reminders: sanitizeReminders(reminders) };
}

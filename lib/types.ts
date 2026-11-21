export type Area = "school" | "ecs" | "other";

export const AREAS: { id: Area; label: string }[] = [
  { id: "school", label: "School" },
  { id: "ecs", label: "ECs" },
  { id: "other", label: "Other" },
];

export interface List {
  id: string;
  area: Area;
  name: string;
  color: string;
  sort: number;
}

/** A custom reminder: an exact time, or minutes before the due time. */
export type TaskReminder = { kind: "offset"; minutes: number } | { kind: "at"; at: string };

/** Single row (id = 1) so the cron and every device agree on the default reminder. */
export interface SettingsRow {
  id: number;
  /** Minutes before the due time for the default reminder; null = no default reminder. */
  default_remind_offset: number | null;
  /** Minutes after local midnight when all-day tasks remind (480 = 8:00 AM). */
  allday_remind_minutes: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  list_id: string | null;
  /** ISO timestamp. For all-day tasks this is local midnight of the due day. */
  due_at: string | null;
  all_day: boolean;
  /**
   * "Takes" length in minutes (1..1440) for a task with a due time: its block on the Home timeline ends at
   * the due time and is this tall. null/absent = 30 minutes. Optional so rows saved before migration 0005 still fit.
   */
  duration_minutes?: number | null;
  /** Whether the default reminder (Settings > Notifications) applies to this task. Needs a due date. */
  remind_default: boolean;
  /** Extra reminders on top of the default one. */
  reminders: TaskReminder[];
  rrule: string | null;
  starred: boolean;
  flagged: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Checklist inside the task (migration 0007). Optional so rows saved before 0007 still fit; new tasks leave it out
   * until a step is added, so saves keep working on a database that hasn't run 0007 yet.
   */
  steps?: TaskStep[];
  /** Where an imported task came from ("classroom", "canvas"); null/absent = made in Daybook. */
  source?: string | null;
  /** The task's id in `source`, so a re-import updates it instead of adding a duplicate. */
  external_id?: string | null;
}

export interface TaskStep {
  id: string;
  title: string;
  done: boolean;
}

export type FocusMode = "stopwatch" | "countdown" | "pomodoro" | "until_event";

/**
 * One timer run on the Focus page (migration 0007). Elapsed time is computed from the timestamps, never from ticks:
 * elapsed = (ended_at ?? paused_at ?? now) - started_at - paused_ms. At most one session is open (ended_at null).
 */
export interface FocusSession {
  id: string;
  task_id: string | null;
  /** A calendar to-do event focused on instead of a task (migration 0008). */
  event_id?: string | null;
  /** The task's or event's title when the session started (migration 0008). */
  title?: string | null;
  kind: "work" | "break";
  mode: FocusMode;
  /** Target length for countdown/pomodoro/until_event; null for a stopwatch. */
  planned_seconds: number | null;
  started_at: string;
  /** Set while paused. */
  paused_at: string | null;
  /** Total paused time before the current pause, in milliseconds. */
  paused_ms: number;
  ended_at: string | null;
  created_at: string;
}

export interface HoursLog {
  id: string;
  /** YYYY-MM-DD, local date */
  date: string;
  list_id: string | null;
  hours: number;
  note: string;
  created_at: string;
}

export interface CalendarRow {
  id: string; // Google calendar id
  summary: string;
  color: string;
  enabled: boolean;
  is_default: boolean;
  read_only: boolean;
}

/** A Google Calendar event as the dashboard sees it. */
export interface GEvent {
  id: string;
  calendar_id: string;
  summary: string;
  description: string;
  /** ISO timestamp, or YYYY-MM-DD for all-day */
  start: string;
  end: string;
  all_day: boolean;
  etag: string;
  /** Present on instances of recurring events */
  recurring_event_id: string | null;
  /** Native Google RRULE lines, present on masters only */
  recurrence: string[] | null;
  /** Dashboard metadata stored in extendedProperties.private */
  list_id: string | null;
  /** List name from a "#list:Name" tag in the description, used when list_id is not set (see descriptionTags). */
  list_tag?: string | null;
  starred: boolean;
  flagged: boolean;
  /** On the dashboard's to-do list (extendedProperties.private.sd_todo). For a series it is stored on the master. */
  todo: boolean;
  /** Popup reminder minutes configured on the event */
  reminders: number[];
  /** The calendar's default alerts apply (Google's reminders.useDefault). Absent on events cached before this field existed. */
  reminders_default?: boolean;
  read_only: boolean;
}

export type Table = "lists" | "tasks" | "hours_logs" | "calendars" | "settings" | "focus_sessions";
export type RowOf<T extends Table> = T extends "lists"
  ? List
  : T extends "tasks"
    ? Task
    : T extends "hours_logs"
      ? HoursLog
      : T extends "settings"
        ? SettingsRow
        : T extends "focus_sessions"
          ? FocusSession
          : CalendarRow;

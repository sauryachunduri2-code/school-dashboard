import { RRule, Weekday } from "rrule";

/**
 * rrule works on "floating" dates: the UTC fields carry the local wall-clock time.
 * Converting both ways keeps "every Tuesday at 4pm" at 4pm across DST changes.
 */
export const toFloating = (d: Date) =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
export const fromFloating = (d: Date) =>
  new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DAY_OBJS: Weekday[] = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Where an RRULE ends up. Tasks use the rrule library on "floating" dates, so a UNTIL of local end-of-day is written
 * as ...T235959Z. Google Calendar reads UNTIL as a real UTC instant (or a plain date for all-day events).
 */
export interface RruleOptions {
  target?: "task" | "event";
  /** Events only: an all-day event needs a date-only UNTIL. */
  allDay?: boolean;
}

export type Repeat =
  | { freq: "daily"; until?: Date | null }
  | { freq: "weekly"; days: number[]; until?: Date | null } // 0=Sun
  | { freq: "monthly"; until?: Date | null };

/** Serialise to an RRULE string (no DTSTART; the task's due date supplies it). */
export function buildRrule(r: Repeat, opts: RruleOptions = {}): string {
  const parts: string[] = [];
  if (r.freq === "daily") parts.push("FREQ=DAILY");
  if (r.freq === "weekly") {
    parts.push("FREQ=WEEKLY");
    const days = [...new Set(r.days)].sort((a, b) => a - b);
    if (days.length) parts.push(`BYDAY=${days.map((d) => DAY_CODES[d]).join(",")}`);
  }
  if (r.freq === "monthly") parts.push("FREQ=MONTHLY");
  if (r.until) parts.push(`UNTIL=${untilStamp(r.until, opts)}`);
  return `RRULE:${parts.join(";")}`;
}

/** The UNTIL value for "last day = `u`" (local date). */
export function untilStamp(u: Date, opts: RruleOptions = {}): string {
  const date = `${u.getFullYear()}${String(u.getMonth() + 1).padStart(2, "0")}${String(u.getDate()).padStart(2, "0")}`;
  if (opts.target !== "event") return `${date}T235959Z`;
  if (opts.allDay) return date;
  // End of the last day in the user's own zone, as the UTC instant Google expects (23:59:59 EST is 04:59:59Z the next day).
  const endOfDay = new Date(u.getFullYear(), u.getMonth(), u.getDate(), 23, 59, 59);
  return endOfDay.toISOString().replace(/[-:]|\.\d{3}/g, "");
}

/** Re-express a task-style rule (UNTIL=...T235959Z, floating) for a Google event. Rules without UNTIL come back unchanged. */
export function toEventRrule(rrule: string, allDay = false): string {
  return rrule.replace(/UNTIL=(\d{4})(\d{2})(\d{2})[0-9TZ]*/, (_, y, m, d) => `UNTIL=${untilStamp(new Date(+y, +m - 1, +d), { target: "event", allDay })}`);
}

export function parseRepeat(rruleStr: string | null, target: "task" | "event" = "task"): Repeat | null {
  if (!rruleStr) return null;
  const body = rruleStr.replace(/^RRULE:/, "");
  const map = Object.fromEntries(body.split(";").map((kv) => kv.split("=") as [string, string]));
  let until: Date | null = null;
  if (map.UNTIL) {
    const m = map.UNTIL.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?/);
    if (m) {
      // A real UTC instant (event rules) is read back as the local day it falls on.
      if (target === "event" && m[4]) {
        const at = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
        until = new Date(at.getFullYear(), at.getMonth(), at.getDate());
      } else until = new Date(+m[1], +m[2] - 1, +m[3]);
    }
  }
  if (map.FREQ === "DAILY") return { freq: "daily", until };
  if (map.FREQ === "MONTHLY") return { freq: "monthly", until };
  if (map.FREQ === "WEEKLY") {
    const days = (map.BYDAY ?? "")
      .split(",")
      .map((c) => DAY_CODES.indexOf(c as (typeof DAY_CODES)[number]))
      .filter((i) => i >= 0);
    return { freq: "weekly", days, until };
  }
  return null;
}

/**
 * Next occurrence strictly after `after`, given the series started at `dtstart`.
 * Returns null when the series has ended.
 */
export function nextOccurrence(rruleStr: string, dtstart: Date, after: Date = dtstart): Date | null {
  const body = rruleStr.replace(/^RRULE:/, "");
  const opts = RRule.parseString(body);
  // A weekly rule with no BYDAY repeats on dtstart's weekday.
  if (opts.freq === RRule.WEEKLY && !opts.byweekday) opts.byweekday = [DAY_OBJS[dtstart.getDay()]];
  const rule = new RRule({ ...opts, dtstart: toFloating(dtstart) });
  const next = rule.after(toFloating(after), false);
  return next ? fromFloating(next) : null;
}

export function describeRrule(rruleStr: string | null, target: "task" | "event" = "task"): string {
  const r = parseRepeat(rruleStr, target);
  if (!r) return "Does not repeat";
  let base = "";
  if (r.freq === "daily") base = "Every day";
  else if (r.freq === "monthly") base = "Every month";
  else if (r.days.length === 0) base = "Every week";
  else if (r.days.length === 5 && [1, 2, 3, 4, 5].every((d) => r.days.includes(d))) base = "Every weekday";
  else base = `Every ${r.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ")}`;
  if (r.until) base += ` until ${r.until.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return base;
}

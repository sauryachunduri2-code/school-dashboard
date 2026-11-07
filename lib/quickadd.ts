import * as chrono from "chrono-node";
import { addDays, startOfDay } from "date-fns";
import { buildRrule, type Repeat } from "./recurrence";
import type { List, TaskReminder } from "./types";

export interface ParsedBase {
  title: string;
  listId: string | null;
  listName: string | null;
  starred: boolean;
  flagged: boolean;
}
export interface ParsedTask extends ParsedBase {
  kind: "task";
  due: Date | null;
  allDay: boolean;
  /** Custom reminders from `remind ...` tokens, on top of the default reminder. */
  reminders: TaskReminder[];
  rrule: string | null;
  /** `takes 1h30m`: how long the task takes, in minutes (only meaningful with a due time). */
  durationMin: number | null;
}
export interface ParsedEvent extends ParsedBase {
  kind: "event";
  start: Date;
  end: Date;
  /** Minutes before start for a Google popup reminder (the first `remind` token) */
  remindOffset: number | null;
  rrule: string | null;
}
export interface ParsedHours {
  kind: "hours";
  hours: number;
  listId: string | null;
  listName: string | null;
  note: string;
  date: Date;
}
export type Parsed = ParsedTask | ParsedEvent | ParsedHours | { kind: "empty" };

const DAY_RE = "(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
const CLOCK = "(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|noon|midnight)";
const REL_DAY = `(?:today|tomorrow|tonight|(?:next\\s+)?${DAY_RE})`;
const REMIND_CLOCK_RE = new RegExp(
  `\\bremind(?:\\s+me)?\\s+(?:at\\s+|on\\s+)?((?:${REL_DAY}\\s+(?:at\\s+)?${CLOCK})|(?:${CLOCK}(?:\\s+(?:on\\s+)?${REL_DAY})?))\\b`,
  "i",
);
const DAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const dayIdx = (s: string) => DAY_INDEX[s.slice(0, 3).toLowerCase()];

const UNIT_MIN: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080 };
const unitMinutes = (u: string) => UNIT_MIN[u[0].toLowerCase()] ?? 1;

const TAKES_RE = /\btakes?\s+(?:(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?:\s*(\d+)\s*(?:minutes?|mins?|m))?|(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)?)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** `#hosa`, `#remember`, `#remember-together`, `#rt` (initials) all resolve to a list. */
export function matchList(token: string, lists: List[]): List | null {
  const t = norm(token);
  if (!t) return null;
  const exact = lists.find((l) => norm(l.name) === t);
  if (exact) return exact;
  const prefix = lists.find((l) => norm(l.name).startsWith(t));
  if (prefix) return prefix;
  // any word of the name: "#psych" -> "AP Psych", "#together" -> "Remember Together"
  const word = lists.find((l) => l.name.split(/\s+/).some((w) => norm(w).startsWith(t)));
  if (word) return word;
  const initials = lists.find((l) => l.name.split(/\s+/).map((w) => w[0]?.toLowerCase()).join("") === t);
  return initials ?? null;
}

function stripOnce(s: string, re: RegExp): [string, RegExpMatchArray | null] {
  const m = s.match(re);
  if (!m) return [s, null];
  return [(s.slice(0, m.index!) + " " + s.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim(), m];
}

function parseRepeat(text: string, now: Date): [string, string | null] {
  let rest = text;
  let repeat: Repeat | null = null;
  let m: RegExpMatchArray | null;

  [rest, m] = stripOnce(rest, new RegExp(`\\bevery\\s+((?:${DAY_RE}(?:\\s*(?:,|and|&)\\s*)?)+)`, "i"));
  if (m) {
    const days = [...m[1].matchAll(new RegExp(DAY_RE, "gi"))].map((x) => dayIdx(x[0]));
    repeat = { freq: "weekly", days };
  }
  if (!repeat) {
    [rest, m] = stripOnce(text, /\bevery\s+weekdays?\b/i);
    if (m) repeat = { freq: "weekly", days: [1, 2, 3, 4, 5] };
  }
  if (!repeat) {
    [rest, m] = stripOnce(text, /\b(?:every\s+day|daily|everyday)\b/i);
    if (m) repeat = { freq: "daily" };
  }
  if (!repeat) {
    [rest, m] = stripOnce(text, /\b(?:every\s+month|monthly)\b/i);
    if (m) repeat = { freq: "monthly" };
  }
  if (!repeat) {
    [rest, m] = stripOnce(text, /\b(?:every\s+week|weekly)\b/i);
    if (m) repeat = { freq: "weekly", days: [] };
  }
  if (!repeat) return [text, null];

  // optional end: "until dec 15" / "for 4 weeks"
  const [afterUntil, um] = stripOnce(rest, /\buntil\s+([a-z0-9/ ,]+?)(?=\s+(?:#|remind|at\b)|$)/i);
  if (um) {
    const d = chrono.en.casual.parseDate(um[1], now, { forwardDate: true });
    if (d) {
      rest = afterUntil;
      repeat.until = d;
    }
  } else {
    const [afterFor, fm] = stripOnce(rest, /\bfor\s+(\d+)\s*(day|week|month)s?\b/i);
    if (fm) {
      rest = afterFor;
      const n = +fm[1];
      const span = fm[2].toLowerCase() === "day" ? n : fm[2].toLowerCase() === "week" ? n * 7 : n * 30;
      repeat.until = addDays(now, span);
    }
  }
  return [rest, buildRrule(repeat)];
}

function cleanTitle(s: string): string {
  return s
    .replace(/\b(?:due|by|on|at|before|until|from|for|@)\s*$/i, "")
    .replace(/^\s*(?:due|by|on|at|before)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .trim();
}

export function parseQuickAdd(input: string, lists: List[], now: Date = new Date()): Parsed {
  let text = input.trim();
  if (!text) return { kind: "empty" };

  // ---- hours: "log 2h hosa poster"
  const logM = text.match(/^log\s+(\d+(?:\.\d+)?|\.\d+)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)?\b\s*(.*)$/i);
  if (logM) {
    let hours = parseFloat(logM[1]);
    if (logM[2] && /^m/i.test(logM[2])) hours = hours / 60;
    let rest = logM[3];
    let list: List | null = null;
    const [r1, hm] = stripOnce(rest, /#([\w-]+)/);
    if (hm) {
      list = matchList(hm[1], lists);
      rest = r1;
    }
    let date = startOfDay(now);
    const dr = chrono.en.casual.parse(rest, now, { forwardDate: false })[0];
    if (dr) {
      date = startOfDay(dr.start.date());
      rest = (rest.slice(0, dr.index) + " " + rest.slice(dr.index + dr.text.length)).trim();
    }
    if (!list) {
      // First word(s) naming a list: "hosa poster", "remember together flyers"
      const words = rest.split(/\s+/);
      for (let n = Math.min(3, words.length); n >= 1 && !list; n--) {
        const cand = matchList(words.slice(0, n).join(" "), lists);
        if (cand && norm(cand.name).startsWith(norm(words.slice(0, n).join(" ")))) {
          list = cand;
          rest = words.slice(n).join(" ");
        }
      }
    }
    return {
      kind: "hours",
      hours: Math.round(hours * 100) / 100,
      listId: list?.id ?? null,
      listName: list?.name ?? null,
      note: cleanTitle(rest),
      date,
    };
  }

  // ---- list token
  let list: List | null = null;
  const [t1, lm] = stripOnce(text, /(?:^|\s)#([\w-]+)/);
  if (lm) {
    list = matchList(lm[1], lists);
    if (list) text = t1;
  }

  // ---- star / flag as standalone tokens
  let starred = false;
  let flagged = false;
  text = text
    .split(/\s+/)
    .filter((tok) => {
      if (tok === "*" || tok === "★") return !(starred = true);
      if (tok === "!" || tok === "⚑") return !(flagged = true);
      return true;
    })
    .join(" ");

  // ---- takes: `takes 1h`, `takes 45m`, `takes 1h30m`, `takes 90 min`, `takes 1.5 hours` (bare number = minutes)
  let durationMin: number | null = null;
  const takesM = text.match(TAKES_RE);
  if (takesM) {
    const mins = takesM[1] != null ? Math.round(parseFloat(takesM[1]) * 60 + (takesM[2] ? parseInt(takesM[2], 10) : 0)) : Math.round(parseFloat(takesM[3]));
    if (mins >= 1 && mins <= 1440) {
      durationMin = mins;
      text = stripOnce(text, TAKES_RE)[0];
    }
  }

  // ---- reminders: any number of `remind 1h` / `remind 8pm` tokens
  const offsets: number[] = [];
  const clockTexts: string[] = [];
  let m: RegExpMatchArray | null;
  for (;;) {
    [text, m] = stripOnce(text, /\bremind(?:\s+me)?\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)\b(?:\s+before)?/i);
    if (m) {
      offsets.push(Math.round(parseFloat(m[1]) * unitMinutes(m[2])));
      continue;
    }
    // "remind 8pm", "remind 8pm tomorrow", "remind thu 7pm", "remind 7pm on thu"
    [text, m] = stripOnce(text, REMIND_CLOCK_RE);
    if (m) {
      clockTexts.push(m[1]);
      continue;
    }
    break;
  }
  const remindOffset = offsets[0] ?? null;

  // ---- repeat
  let rrule: string | null = null;
  [text, rrule] = parseRepeat(text, now);

  // ---- date / time
  const results = chrono.en.casual.parse(text, now, { forwardDate: true });
  const hit = results[0];
  let due: Date | null = null;
  let end: Date | null = null;
  let allDay = true;
  if (hit) {
    due = hit.start.date();
    allDay = !hit.start.isCertain("hour");
    if (allDay) due = startOfDay(due);
    // "friday" said on a Friday means next Friday
    if (allDay && new RegExp(`^${DAY_RE}$`, "i").test(hit.text.trim()) && +due === +startOfDay(now)) due = addDays(due, 7);
    if (hit.end && hit.end.isCertain("hour")) end = hit.end.date();
    text = text.slice(0, hit.index) + " " + text.slice(hit.index + hit.text.length);
  }
  // A repeat with no explicit day starts on its first occurrence: today, or the next listed weekday.
  if (rrule && (!hit || !hit.start.isCertain("day"))) {
    const days = rrule.match(/BYDAY=([A-Z,]+)/)?.[1]?.split(",").map((c) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(c));
    const base = due ?? startOfDay(now);
    let d = startOfDay(base);
    if (days?.length) {
      for (let i = 0; i < 7 && !days.includes(d.getDay()); i++) d = addDays(d, 1);
    }
    due = allDay ? d : new Date(d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes());
    if (!allDay && +due < +now && d.getTime() === startOfDay(now).getTime() && days?.length) {
      // today's slot already passed: move to the next listed day
      let n = addDays(d, 1);
      for (let i = 0; i < 7 && !days.includes(n.getDay()); i++) n = addDays(n, 1);
      due = new Date(n.getFullYear(), n.getMonth(), n.getDate(), base.getHours(), base.getMinutes());
    }
    if (end && !allDay) end = new Date(+due + (+end - +base));
  }


  const title = cleanTitle(text);

  const base: ParsedBase = {
    title,
    listId: list?.id ?? null,
    listName: list?.name ?? null,
    starred,
    flagged,
  };

  // time range => event
  if (due && end && !allDay && +end > +due) {
    return { kind: "event", ...base, start: due, end, remindOffset, rrule };
  }

  const reminders: TaskReminder[] = [];
  const addReminder = (r: TaskReminder) => {
    if (!reminders.some((x) => (x.kind === "offset" && r.kind === "offset" ? x.minutes === r.minutes : x.kind === "at" && r.kind === "at" && x.at === r.at))) reminders.push(r);
  };
  // "remind 1h": before the due time, or, with no due date, that long from now.
  for (const minutes of offsets) addReminder(due ? { kind: "offset", minutes } : { kind: "at", at: new Date(+now + minutes * 60000).toISOString() });
  for (const clock of clockTexts) {
    // A named day ("thu", "tomorrow") is relative to now; a bare time ("8pm") fires on the due day.
    const namedDay = new RegExp(REL_DAY, "i").test(clock);
    const rd = chrono.en.casual.parse(clock, namedDay ? now : (due ?? now), { forwardDate: namedDay || !due })[0];
    if (!rd) continue;
    let at = rd.start.date();
    if (due && !namedDay) at = new Date(due.getFullYear(), due.getMonth(), due.getDate(), at.getHours(), at.getMinutes());
    addReminder({ kind: "at", at: at.toISOString() });
  }

  return {
    kind: "task",
    ...base,
    due,
    allDay,
    reminders,
    rrule,
    durationMin,
  };
}

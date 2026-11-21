/** One thing on the brief. Facts come from Daybook data only; Gemini never adds or changes items. */
export interface BriefItem {
  kind: "event" | "task";
  title: string;
  /** ISO instant; null for an undated task. All-day items carry local midnight of their day. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  /** "8:05 AM" in the owner's zone, null for all-day */
  time: string | null;
  endTime: string | null;
  /** List name ("AP Chem", "HOSA"), when the item has one */
  list: string | null;
  starred: boolean;
  flagged: boolean;
  /** Whole days from today, for upcoming items */
  daysAway?: number;
}

export interface FreeBlock {
  start: string;
  end: string;
  time: string;
  endTime: string;
  minutes: number;
}

export interface BriefFacts {
  /** YYYY-MM-DD in `tz` */
  date: string;
  weekday: string;
  tz: string;
  now: string;
  nowTime: string;
  today: BriefItem[];
  /** The next timed item today that hasn't started yet */
  next: BriefItem | null;
  overdue: BriefItem[];
  /** Starred or flagged items in the next 7 days, soonest first */
  upcoming: BriefItem[];
  /** Gaps of 45 min or more between now and 10 PM with nothing timed in them */
  free: FreeBlock[];
}

export type CalendarStatus = "ok" | "not-configured" | "not-connected" | "error";

export interface Prose {
  headline: string;
  summary: string;
  focus: string | null;
}

export interface MorningBrief extends Prose {
  date: string;
  generatedAt: string;
  source: "gemini" | "rules";
  next: BriefItem | null;
  today: BriefItem[];
  overdue: BriefItem[];
  upcoming: BriefItem[];
  calendar: CalendarStatus;
}

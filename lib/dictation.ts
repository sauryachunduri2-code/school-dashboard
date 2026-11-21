import type { List } from "./types";

/**
 * Turns a speech transcript ("AP Psych essay is due Friday at nine p.m., remind me an hour before")
 * into the typed quick-add syntax ("AP Psych essay due Friday at 9pm remind 1 hour #ap-psych"),
 * so the one parser in lib/quickadd.ts handles both. Rewrites happen in place; anything it doesn't
 * recognise is left alone and ends up in the title.
 */
export function normalizeDictation(transcript: string, lists: List[], now: Date = new Date()): string {
  let s = ` ${transcript.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim()} `;
  if (!s.trim()) return "";

  s = basics(s);
  s = numberWords(s);
  s = durations(s);
  s = clockWords(s);
  s = hoursLog(s);
  s = reminders(s);
  s = takes(s);
  s = repeats(s);
  s = dates(s, now);
  s = flags(s);
  const isEvent = calendarWords(s);
  s = isEvent.text;
  s = meridiems(s, now);
  s = durationToRange(s, isEvent.event);
  s = reminderTimes(s);
  const tagged = listTags(s, lists);
  s = tagged.text;
  s = fillers(s);
  if (tagged.list) s += ` #${slug(tagged.list.name)}`;
  return s.replace(/\s+/g, " ").trim();
}

/** Among the recogniser's alternatives, prefer one that names a list when the top one doesn't. */
export function pickAlternative(alternatives: string[], lists: List[]): string {
  const top = alternatives[0] ?? "";
  if (listTags(` ${top} `, lists).list) return top;
  return alternatives.find((a) => listTags(` ${a} `, lists).list) ?? top;
}

// ---------------------------------------------------------------------------------------------

const UNIT = "(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?)";
const DAY = "(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const CLOCK = "\\d{1,2}(?::\\d{2})?(?:am|pm)";

const re = (src: string, flags = "gi") => new RegExp(src, flags);

function basics(s: string): string {
  return (
    s
      // "a.m." / "P.M." / "p. m."
      .replace(/\b([ap])\.\s?m\b\.?/gi, (_, c: string) => `${c.toLowerCase()}m`)
      // sentence punctuation the recogniser adds; keep "Mr." and the ":" in times
      .replace(/(?<!\b(?:mr|mrs|ms|dr|st|prof|jr|sr|vs|etc|mt|ft))\.(?=\s|$)/gi, " ")
      // a "!" on its own is the flag token; one stuck to a word is just punctuation
      .replace(/(?<=\S)!|[?;]/g, " ")
      .replace(/,/g, " , ")
      .replace(/\b(?:um+|uh+|erm|uhm|hmm+)\b/gi, " ")
      .replace(/\s+/g, " ")
  );
}

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUM = `(?:(?:${Object.keys(TENS).join("|")})(?:[\\s-]+(?:one|two|three|four|five|six|seven|eight|nine)\\b)?|${SMALL.join("|")})`;
const NUM_OR_DIGIT = `(?:\\d{1,2}|${NUM})`;

function wordNum(w: string): number {
  if (/^\d+$/.test(w)) return +w;
  return w
    .toLowerCase()
    .split(/[\s-]+/)
    .reduce((n, part) => n + (TENS[part] ?? Math.max(0, SMALL.indexOf(part))), 0);
}

/** Number words become digits only where they read as a time or an amount, so "chapter one" stays put. */
function numberWords(s: string): string {
  // "nine thirty", "nine oh five", "at 9 30" after a time word
  s = s.replace(
    re(`\\b(at|from|until|till|til|by|around|about|before|after|between|to|and|-)\\s+(${NUM_OR_DIGIT})\\s+(?:(?:o|oh)\\s+(${NUM_OR_DIGIT})|(${NUM_OR_DIGIT}))(?=\\s*(?:am|pm|a\\.m|p\\.m|tonight|in the|at night|this|tomorrow|today|on|\\b${DAY}\\b|,|$|\\s))`),
    (m, prep: string, h: string, oMin: string | undefined, min: string | undefined) => {
      const hour = wordNum(h);
      const minute = oMin != null ? wordNum(oMin) : wordNum(min!);
      if (hour < 1 || hour > 12) return m;
      if (oMin != null ? minute < 1 || minute > 9 : minute < 10 || minute > 59) return m;
      return `${prep} ${hour}:${String(minute).padStart(2, "0")}`;
    },
  );
  // "quarter past three", "half past 3", "quarter to four"
  s = s.replace(re(`\\b(?:a\\s+)?quarter\\s+(?:past|after)\\s+(${NUM_OR_DIGIT})\\b`), (_, h) => `${wordNum(h)}:15`);
  s = s.replace(re(`\\bhalf\\s+past\\s+(${NUM_OR_DIGIT})\\b`), (_, h) => `${wordNum(h)}:30`);
  s = s.replace(re(`\\b(?:a\\s+)?quarter\\s+(?:to|till|til|of)\\s+(${NUM_OR_DIGIT})\\b`), (m, h) => {
    const n = wordNum(h);
    return n >= 1 && n <= 12 ? `${n === 1 ? 12 : n - 1}:45` : m;
  });
  // before a unit or am/pm: "two hours", "nine pm", "three o'clock", "two and a half hours"
  s = s.replace(re(`\\b(${NUM})(?=(?:\\s+and\\s+a\\s+half)?\\s*(?:${UNIT}|am|pm|o'?\\s?clock|oclock)\\b)`), (_, n) => String(wordNum(n)));
  // after a time word: "at nine", "from three", "until five"
  s = s.replace(re(`\\b(at|from|until|till|til|by|around|before|after|between)\\s+(${NUM})\\b`), (m, prep: string, n: string) => {
    const v = wordNum(n);
    return v >= 1 && v <= 12 ? `${prep} ${v}` : m;
  });
  // the end of a range: "3 to four", "3pm and four"
  s = s.replace(re(`(\\d(?:am|pm)?)\\s+(to|and|until|till|til|through|thru|-)\\s+(${NUM})\\b`), (m, a: string, sep: string, n: string) => {
    const v = wordNum(n);
    return v >= 1 && v <= 12 ? `${a} ${sep} ${v}` : m;
  });
  // "every two days" / "in three weeks" are covered by the unit rule; "the 1st" style ordinals live in dates()
  return s;
}

/** Amounts of time, spoken loosely, as plain numbers: "an hour and a half" -> "90 minutes". */
function durations(s: string): string {
  s = s.replace(/\b(?:an?|1|one)\s+hours?\s+and\s+a\s+half\b/gi, "90 minutes");
  s = s.replace(/\b(\d+)\s+and\s+a\s+half\s+(hours?|days?|weeks?)\b/gi, (_, n, u) => `${+n + 0.5} ${u}`);
  s = s.replace(/\b(\d+)\s+(hours?)\s+and\s+a\s+half\b/gi, (_, n, u) => `${+n + 0.5} ${u}`);
  s = s.replace(/\b(?:a\s+)?half\s+(?:an\s+|a\s+)?hour\b/gi, "30 minutes");
  s = s.replace(/\b(?:a\s+)?quarter\s+(?:of\s+an\s+)?hour\b/gi, "15 minutes");
  s = s.replace(/\ba\s+couple(?:\s+of)?\s+(minutes|hours|days|weeks)\b/gi, "2 $1");
  // "an hour" / "a day" where it's clearly an amount
  s = s.replace(
    /\b(remind(?:\s+me)?|takes?|for|in|about|around|like|just|log|logged|spent|worked|did|least|over|under|maybe|roughly|approximately)\s+an?\s+(minute|hour|day|week|month)\b/gi,
    "$1 1 $2",
  );
  s = s.replace(/\ban?\s+(minute|hour|day|week)(?=\s+(?:before|early|earlier|ahead|in advance|beforehand|prior|from now|later)\b)/gi, "1 $1");
  // "1 hour 30 minutes", "2 hours and 15 minutes"
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:and\s+)?(\d+)\s*(?:minutes?|mins?|m)\b/gi, (_, h, m) => `${Math.round(+h * 60 + +m)} minutes`);
  return s;
}

function clockWords(s: string): string {
  return s
    .replace(/\b(\d{1,2}(?::\d{2})?)\s*o'?\s?clock\b/gi, "$1")
    .replace(/\b(\d{1,2}(?::\d{2})?)\s+([ap])m\b/gi, (_, t, c: string) => `${t}${c.toLowerCase()}m`)
    .replace(/\b(\d{1,2}(?::\d{2})?)([AP])M\b/g, (_, t, c: string) => `${t}${c.toLowerCase()}m`)
    .replace(/\b(\d{1,2}(?::\d{2})?)\s+(?:in\s+the\s+morning|a\s?m)\b/gi, "$1am")
    .replace(/\b(\d{1,2}(?::\d{2})?)\s+(?:in\s+the\s+(?:afternoon|evening)|at\s+night)\b/gi, "$1pm")
    .replace(/\b(?:noon|midday)\b/gi, "12pm")
    // a deadline "at midnight" means the end of that day, not its first minute
    .replace(/\bmidnight\b/gi, "11:59pm");
}

/** "I spent two hours on the HOSA poster" -> "log 2 hours HOSA poster" */
function hoursLog(s: string): string {
  return s.replace(
    /^\s*(?:i\s+)?(?:just\s+)?(?:log(?:ged)?|spent|worked|did|put\s+in)\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?)\b(?:\s+(?:of|on|for|doing|working\s+on|at|in|towards?))?(?:\s+(?:the|my))?\s+/i,
    (_, n, u) => ` log ${n} ${u} `,
  );
}

function reminders(s: string): string {
  // every way of asking for a reminder becomes "remind"
  s = s.replace(/\b(?:and\s+)?(?:please\s+)?(?:set|add|give\s+me|put|create|with|include)\s+(?:a\s+|an\s+)?(?:reminder|alert|notification)s?(?:\s+for)?\b/gi, " remind ");
  s = s.replace(/\b(?:and\s+)?(?:remind|alert|notify|ping|warn)\s+me\b(?!\s+to\b)/gi, " remind ");
  s = s.replace(/\breminder\s+(?=\d|at\b|on\b|the\b|tomorrow\b|tonight\b)/gi, "remind ");
  // relative reminders: "the day before", "the night before", "a week before"
  s = s.replace(/\bremind\s+(?:on\s+)?the\s+(day|night|evening)\s+before\b/gi, "remind 1 day");
  s = s.replace(/\bremind\s+(?:on\s+)?the\s+week\s+before\b/gi, "remind 1 week");
  s = s.replace(/\bremind\s+(?:on\s+)?the\s+(?:morning|day)\s+of\b(?:\s+it)?/gi, "remind 8am");
  // drop the "before it starts" tail, which the parser doesn't need
  s = s.replace(
    re(`\\b(remind\\s+(?:in\\s+)?\\d+(?:\\.\\d+)?\\s*${UNIT})\\s+(?:before(?:\\s+(?:it(?:'s|\\s+is)?(?:\\s+(?:due|starts?|begins?))?|that|then|hand|the\\s+(?:event|meeting|deadline|class|task|due\\s+date|start)))?|beforehand|ahead(?:\\s+of\\s+time)?|early|earlier|in\\s+advance|prior(?:\\s+to\\s+it)?)\\b`),
    "$1",
  );
  // "remind 1 day and 1 hour before" -> two reminders
  for (let i = 0; i < 3; i++) {
    s = s.replace(re(`\\b(remind\\s+(?:\\d+(?:\\.\\d+)?\\s*${UNIT}|at\\s+${CLOCK}|${CLOCK}))\\s*(?:,|and|also|plus|then)\\s+(?:also\\s+)?(?:again\\s+)?(\\d+(?:\\.\\d+)?\\s*${UNIT}(?:\\s+before)?|at\\s+\\d)`), "$1 remind $2");
  }
  return s;
}

/** Reminders that name a part of the day instead of a time get a sensible one. */
function reminderTimes(s: string): string {
  return s
    .replace(re(`\\bremind\\s+(?:me\\s+)?(?:on\\s+)?((?:tomorrow|today|${DAY}))\\s+(?:in\\s+the\\s+)?morning\\b`), "remind $1 8am")
    .replace(re(`\\bremind\\s+(?:me\\s+)?(?:on\\s+)?((?:tomorrow|today|${DAY}))\\s+(?:in\\s+the\\s+)?afternoon\\b`), "remind $1 3pm")
    .replace(re(`\\bremind\\s+(?:me\\s+)?(?:on\\s+)?((?:tomorrow|${DAY}))\\s+(?:in\\s+the\\s+)?(?:evening|night)\\b`), "remind $1 7pm")
    .replace(/\bremind\s+(?:me\s+)?(?:tonight|this\s+evening)(?!\s+at)\b/gi, "remind today 7pm")
    .replace(/\bremind\s+(?:me\s+)?this\s+afternoon\b/gi, "remind today 3pm")
    .replace(/\bremind\s+(?:me\s+)?this\s+morning\b/gi, "remind today 8am")
    .replace(re(`\\bremind\\s+(?:me\\s+)?(?:on\\s+)?(tomorrow|${DAY})\\b(?!\\s+(?:at\\s+)?\\d)`), "remind $1 8am");
}

function takes(s: string): string {
  return s.replace(
    /\b(?:and\s+)?(?:it(?:'ll|\s+will|\s+should|\s+might|'s\s+going\s+to)?|that(?:'ll|\s+will)?|which(?:\s+will|\s+should)?|should|will)?\s*(?:takes?|taking)\s+(?:me\s+)?(?:about|around|like|roughly|approximately|maybe|probably|up\s+to|at\s+least|just)?\s*(?=\d)/gi,
    " takes ",
  );
}

const DAY_FULL: Record<string, string> = { sun: "sunday", mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday", fri: "friday", sat: "saturday" };
const PLURAL_DAY = "(?:sun|mon|tues|wednes|thurs|fri|satur)days";

function repeats(s: string): string {
  s = s.replace(/\b(?:each|every\s+single)\s+(?=(?:day|week|month|weekday|morning|night|evening)\b|\b(?:sun|mon|tue|wed|thu|fri|sat))/gi, "every ");
  s = s.replace(/\b(?:every|on|each)\s+(?:school\s+days?|weekdays|week\s+days)\b|\bevery\s+week\s+day\b|\bweekdays\b/gi, "every weekday");
  s = s.replace(/\bevery\s+(?:morning|night|evening)\b/gi, "every day");
  s = s.replace(/\bonce\s+a\s+week\b/gi, "every week");
  s = s.replace(/\bonce\s+a\s+month\b/gi, "every month");
  s = s.replace(/\bonce\s+a\s+day\b|\bevery\s+single\s+day\b/gi, "every day");
  // "on Tuesdays and Thursdays" / "every Monday Wednesday and Friday" -> "every tuesday, thursday"
  s = s.replace(re(`\\b(?:on\\s+|every\\s+)?(${PLURAL_DAY}(?:\\s*(?:,|and|&|or)?\\s*${PLURAL_DAY})*)\\b`), (_, days: string) => {
    const list = [...days.matchAll(re(PLURAL_DAY))].map((d) => d[0].toLowerCase().slice(0, -1));
    return `every ${list.join(" and ")}`;
  });
  s = s.replace(re(`\\bevery\\s+(${DAY}(?:\\s*(?:,|and|&)?\\s*\\b${DAY}\\b)+)`), (_, days: string) => {
    const list = [...days.matchAll(re(`\\b${DAY}\\b`))].map((d) => DAY_FULL[d[0].slice(0, 3).toLowerCase()]);
    return `every ${list.join(" and ")}`;
  });
  // "weekly on Tuesday" -> "every tuesday"
  s = s.replace(re(`\\b(?:weekly|every\\s+week)\\s+on\\s+(${DAY})\\b`), "every $1");
  s = s.replace(re(`\\bon\\s+(${DAY})\\s+(?:weekly|every\\s+week)\\b`), "every $1");
  // "for the next 4 weeks" -> "for 4 weeks" (the parser's repeat end)
  s = s.replace(/\bfor\s+the\s+next\s+(\d+)\s+(days?|weeks?|months?)\b/gi, "for $1 $2");
  return s;
}

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};
const ORD_WORD = `(?:(?:twenty|thirty)[\\s-]+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|${Object.keys(ORDINALS).join("|")})`;
const ordValue = (w: string) => {
  const m = w.toLowerCase().match(/^(\d+)/);
  if (m) return +m[1];
  const parts = w.toLowerCase().split(/[\s-]+/);
  return parts.length === 2 ? TENS[parts[0]] + ORDINALS[parts[1]] : ORDINALS[parts[0]];
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dates(s: string, now: Date): string {
  s = s.replace(/\b(?:is|are|was|will\s+be|it's|it\s+is|that's|it's\s+all)\s+due\b/gi, "due");
  s = s.replace(/\b(?:the\s+)?(?:due\s+date|deadline)\s+(?:for|of|to)\s+(.+?)\s+(?:is|was|will\s+be)\s+/gi, "$1 due ");
  s = s.replace(/\b(?:the\s+)?(?:due\s+date|deadline)\s+(?:is\s+)?/gi, "due ");
  s = s.replace(/\bdue\s+on\b/gi, "due");
  s = s.replace(/\ba\s+week\s+from\s+(?:today|now)\b/gi, "in 1 week");
  // "on the 20th" / "by the twenty-first" -> "on November 20" (this month, or next if that day has passed)
  s = s.replace(
    re(`\\b(on|by|due|for|until|before|till|starting)\\s+the\\s+(\\d{1,2}(?:st|nd|rd|th)|${ORD_WORD})\\b(?!\\s+(?:of\\b|${MONTH}))`),
    (m, prep: string, ord: string) => {
      const day = ordValue(ord);
      if (!day || day > 31) return m;
      let month = now.getMonth();
      let year = now.getFullYear();
      if (day < now.getDate()) month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      // a 31st in a 30-day month rolls to the next month that has one
      while (new Date(year, month, day).getDate() !== day) month += 1;
      return `${prep} ${MONTHS[month % 12]} ${day}`;
    },
  );
  // "the 20th of November" -> "November 20"
  s = s.replace(re(`\\bthe\\s+(\\d{1,2}(?:st|nd|rd|th)|${ORD_WORD})\\s+of\\s+(${MONTH})`), (_, ord, mon) => `${mon} ${ordValue(ord)}`);
  return s;
}

function flags(s: string): string {
  const STAR = " * ";
  const FLAG = " ! ";
  s = s.replace(/\b(?:and\s+)?(?:(?:add|with|start|set|put|give\s+it|make\s+it)\s+(?:a\s+)?count\s?-?down(?:\s+(?:for|to|on)\s+(?:it|this|that))?|count\s?-?down\s+to\s+(?:it|this|that)|star\s+(?:it|this|that)|(?:with|add)\s+a\s+star|starred)\b/gi, STAR);
  s = s.replace(/\b(?:and\s+)?count\s?-?down\s*(?=,|$)/gi, STAR);
  s = s.replace(
    /\b(?:and\s+)?(?:(?:flag|mark|make|set)\s+(?:it|this|that)(?:\s+as)?(?:\s+(?:important|urgent|high\s+priority|a\s+priority|flagged))?|(?:it'?s|it\s+is|this\s+is|that's)\s+(?:really\s+|very\s+|super\s+)?(?:important|urgent|high\s+priority)|(?:high|top)\s+priority|with\s+a\s+flag|add\s+a\s+flag|flagged)\b/gi,
    FLAG,
  );
  // a trailing "important" / "urgent" reads as the flag
  s = s.replace(/\s(?:important|urgent)\s*$/i, FLAG);
  return s;
}

/** "add an event ...", "put it on my calendar": these make an event even with only a start time. */
function calendarWords(s: string): { text: string; event: boolean } {
  let event = false;
  const mark = () => {
    event = true;
    return " ";
  };
  s = s.replace(/^\s*(?:please\s+)?(?:add|create|make|put|schedule|set\s+up|new)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:calendar\s+)?event\b(?:\s*:|\s+(?:called|named|titled|for))?/i, mark);
  s = s.replace(/\b(?:to|on|in|onto)\s+(?:my|the)\s+(?:google\s+)?calendar\b/gi, mark);
  s = s.replace(/\b(?:as\s+)?(?:a\s+|an\s+)?calendar\s+event\b/gi, mark);
  if (event) s = s.replace(/^\s*(?:please\s+)?(?:add|put|schedule|create)\s+/i, " ");
  return { text: s, event };
}

const DATEISH = re(`\\b(?:today|tonight|tomorrow|yesterday|${DAY}|${MONTH}|next|this|weekend|week|every|daily|weekly|monthly|weekdays?)\\b|\\d{1,2}\\/\\d{1,2}|\\d(?:st|nd|rd|th)\\b`, "i");
const NOT_A_TIME = "\\b(?:chapters?|ch|pages?|pp?|problems?|questions?|q|sections?|units?|lessons?|numbers?|no|exercises?|parts?|slides?|steps?|rooms?|periods?|grades?|levels?|verses?|lines?)";
const NOT_A_TIME_BEFORE = re(`${NOT_A_TIME}\\s*$`, "i");

/** Gives every spoken clock time an am/pm, so "the meeting at 3" isn't 3 in the morning. */
function meridiems(s: string, now: Date): string {
  const today = !DATEISH.test(s);
  const deadline = /\b(?:due|deadline|submit|turn\s+in|by)\b/i.test(s);
  const ctx = (at: number, len: number) => {
    const win = s.slice(Math.max(0, at - 30), at + len + 30).toLowerCase();
    if (/\b(?:tonight|evening|night|afternoon|dinner|after\s+school)\b/.test(win)) return "pm";
    if (/\b(?:morning|breakfast|before\s+school)\b/.test(win)) return "am";
    return null;
  };
  const guess = (h: number, m: number, at: number, len: number): number => {
    if (h > 12 || h === 0) return h; // already 24-hour
    const c = ctx(at, len);
    let pm: boolean;
    if (c) pm = c === "pm";
    else if (h === 12 || h <= 6) pm = true;
    else pm = deadline;
    if (!c && !pm && today) {
      // said at 2pm, "at 9" means tonight, not tomorrow morning
      const amPassed = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m) < now;
      const pmAhead = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h + 12, m) > now;
      if (amPassed && pmAhead) pm = true;
    }
    return (h % 12) + (pm ? 12 : 0);
  };
  const to24 = (h: number, mer?: string) => (mer ? (h % 12) + (mer.toLowerCase() === "pm" ? 12 : 0) : h);
  const fmt = (h24: number, m: number) => {
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""}${h24 >= 12 && h24 < 24 ? "pm" : "am"}`;
  };
  const after = `(?!\\s*(?:${UNIT}|st\\b|nd\\b|rd\\b|th\\b|\\/|:\\d|\\d|%|percent|people|times|points?|pages?|problems?|questions?))`;

  // "chapters 3 to 4" is not a time: a non-breaking hyphen keeps the parser's date reader off it
  s = s.replace(re(`(${NOT_A_TIME}\\s*)(\\d+)\\s*(?:-|–|to|through|thru)\\s*(\\d+)\\b`), "$1$2\u2011$3");
  // ranges: "from 3 to 4", "between 2 and 3pm", "3:30-5", "11 to 1"
  s = s.replace(
    re(`(\\b(?:from|between)\\s+)?\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\s*(?:-|–|—|\\bto\\b|\\buntil\\b|\\btill\\b|\\btil\\b|\\bthrough\\b|\\bthru\\b|\\band\\b)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\b${after}`),
    (m, lead: string | undefined, sh: string, sm: string | undefined, smer: string | undefined, eh: string, em: string | undefined, emer: string | undefined, offset: number) => {
      const before = s.slice(0, offset);
      if (/\d\/$|\/\s*$/.test(before) || NOT_A_TIME_BEFORE.test(before)) return m;
      if (/\band\b/i.test(m) && !/^between/i.test(lead?.trim() ?? "")) return m;
      const timeLike = lead || smer || emer || sm || em || re(`(?:\\bat|\\b${DAY}|\\btomorrow|\\btoday|\\btonight)\\s*$`, "i").test(before);
      if (!timeLike) return m;
      const h1 = +sh, h2 = +eh, m1 = +(sm ?? 0), m2 = +(em ?? 0);
      if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return m;
      let start: number, end: number;
      if (emer && !smer) {
        end = to24(h2, emer);
        const cands = [h1 % 12, (h1 % 12) + 12].filter((x) => x * 60 + m1 < end * 60 + m2);
        start = cands.length ? Math.max(...cands) : to24(h1, emer);
      } else {
        start = smer ? to24(h1, smer) : guess(h1, m1, offset, m.length);
        if (emer) end = to24(h2, emer);
        else {
          const cands = [h2 % 12, (h2 % 12) + 12, (h2 % 12) + 24].filter((x) => x * 60 + m2 > start * 60 + m1);
          end = h2 > 12 ? h2 : cands.length ? Math.min(...cands) : h2;
        }
      }
      return ` ${fmt(start, m1)}-${fmt(end % 24 === 0 && end > 0 ? 24 : end, m2).replace(/^12am$/, "11:59pm")} `;
    },
  );

  // single times after a time word or a day: "at 3", "by 11", "friday 4:30", "tomorrow at 7"
  s = s.replace(
    re(`(\\b(?:at|by|around|before|after|until|till|@)\\s+|\\b(?:${DAY}|tomorrow|today|tonight)\\s+(?:at\\s+)?)(\\d{1,2})(?::(\\d{2}))?\\b(?!\\s*(?:am|pm)\\b)(?!-)${after}`),
    (m, lead: string, h: string, mm: string | undefined, offset: number) => {
      const hour = +h, min = +(mm ?? 0);
      if (hour > 23 || min > 59) return m;
      if (/^(?:until|till)/i.test(lead) && !mm && !/\b(?:from|at|starting)\b/i.test(s)) return m;
      return `${lead}${fmt(guess(hour, min, offset, m.length), min)}`;
    },
  );
  // a lone "4:30" anywhere
  s = s.replace(re(`(^|[^\\d:/])(\\d{1,2}):(\\d{2})\\b(?!\\s*(?:am|pm)\\b)(?!-)${after}`), (m, pre: string, h: string, mm: string, offset: number) => {
    if (+h > 23 || +mm > 59 || NOT_A_TIME_BEFORE.test(s.slice(0, offset + pre.length))) return m;
    return `${pre}${fmt(guess(+h, +mm, offset, m.length), +mm)}`;
  });
  // "7pm-9pm tonight": the pm is settled, so "tonight" only says which day (unless another word already does)
  const otherDay = re(`\\b(?:today|tomorrow|${DAY}|${MONTH}|next|this\\s+(?!evening))\\b|\\d{1,2}\\/\\d{1,2}`, "i").test(s);
  return s.replace(/\b(?:tonight|this\s+evening|at\s+night)\b/gi, (w, offset: number) =>
    re(`${CLOCK}\\s*$`, "i").test(s.slice(Math.max(0, offset - 14), offset)) ? (otherDay ? " " : "today") : w,
  );
}

/** "at 3pm for an hour" becomes "3pm-4pm"; without a start time "for 2 hours" is how long it takes. */
function durationToRange(s: string, isEvent: boolean): string {
  const clocks = [...s.matchAll(re(`(?<![-\\d:])\\b(\\d{1,2})(?::(\\d{2}))?(am|pm)\\b(?!-)`))].filter((c) => {
    const before = s.slice(0, c.index);
    return !/\bremind\s+(?:at\s+|on\s+)?(?:\S+\s+){0,2}$/i.test(before);
  });
  const ranged = re(`${CLOCK}-${CLOCK}`, "i").test(s);
  const dur = s.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?)\b/i);
  const minutes = dur ? Math.round(+dur[1] * (/^h/i.test(dur[2]) ? 60 : 1)) : null;
  if (!ranged && clocks.length === 1 && (minutes || isEvent)) {
    const c = clocks[0];
    const start = ((+c[1] % 12) + (c[3].toLowerCase() === "pm" ? 12 : 0)) * 60 + +(c[2] ?? 0);
    const end = start + (minutes ?? 60);
    if (end < 24 * 60) {
      const h = Math.floor(end / 60), m = end % 60;
      const endText = `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`;
      s = s.slice(0, c.index) + `${c[0]}-${endText}` + s.slice(c.index! + c[0].length);
      if (dur) s = s.replace(dur[0], " ");
      return s;
    }
  }
  if (dur && !/\btakes\s+\d/i.test(s)) s = s.replace(dur[0], ` takes ${dur[1]} ${dur[2]} `);
  return s;
}

// ---- lists ---------------------------------------------------------------------------------

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** How close a heard phrase is to a list name, allowing for recogniser slips and "AP Psychology" for "AP Psych". */
function sounds(heard: string, name: string): boolean {
  if (!heard || !name) return false;
  if (heard === name) return true;
  if (name.length >= 4 && heard.startsWith(name) && /^(?:s|es|ology|ologys|ics)$/.test(heard.slice(name.length))) return true;
  if (heard.length >= 4 && name.startsWith(heard) && /^(?:s|es)$/.test(name.slice(heard.length))) return true;
  if (name.length >= 6) return editDistance(heard, name) <= (name.length >= 10 ? 2 : 1);
  return false;
}

interface Tok {
  n: string;
  start: number;
  end: number;
}
const tokenize = (s: string): Tok[] => [...s.matchAll(/[A-Za-z0-9]+(?:'[A-Za-z]+)?/g)].map((m) => ({ n: norm(m[0]), start: m.index!, end: m.index! + m[0].length }));

/** Tokens consumed when `list` is named starting at toks[i] ("a p psych" and "H O S A" join up). */
function matchAt(toks: Tok[], i: number, list: List): number {
  const target = norm(list.name);
  let acc = "";
  let best = 0;
  for (let k = 1; i + k <= toks.length && k <= 6; k++) {
    acc += toks[i + k - 1].n;
    if (sounds(acc, target)) best = k;
    if (acc.length > target.length + 6) break;
  }
  return best;
}

const PREPS = new Set(["for", "in", "on", "to", "under", "into"]);
const DETS = new Set(["the", "my", "our"]);
const LIST_NOUNS = new Set(["list", "class", "folder", "area", "category", "project", "section", "tab", "stuff", "club"]);
const STRUCTURAL = re(`^\\s*(?:$|,|#|!|\\*|remind\\b|every\\b|takes\\b|due\\b|by\\b|at\\b|on\\b|from\\b|tomorrow\\b|today\\b|tonight\\b|next\\b|this\\b|in\\s+\\d|\\d|${DAY}\\b|${MONTH}\\b)`, "i");

/**
 * Finds the list the speaker meant. "for AP Psych" / "in my HOSA list" / "hashtag HOSA" are taken out of
 * the title; a list named as part of the title ("HOSA meeting") stays in it and still files the item.
 */
function listTags(s: string, lists: List[]): { text: string; list: List | null } {
  if (!lists.length) return { text: s, list: null };
  const toks = tokenize(s);
  // longer names first, so "Remember Together" beats a list called "Remember"
  const byLength = [...lists].sort((a, b) => norm(b.name).length - norm(a.name).length);
  const at = (i: number) => {
    for (const l of byLength) {
      const k = matchAt(toks, i, l);
      if (k) return { list: l, k };
    }
    return null;
  };
  // After "for" / "in" a single word of the name is enough: "for psych class", "in olympiad"
  const loose = (i: number) => {
    const w = toks[i]?.n;
    if (!w || w.length < 4) return null;
    const l = byLength.find((x) => x.name.split(/\s+/).some((part) => sounds(w, norm(part))));
    return l ? { list: l, k: 1 } : null;
  };

  let bare: { list: List; len: number } | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // spoken or typed hashtag
    if (t.n === "hashtag" || t.n === "pound" || (t.n === "hash" && toks[i + 1]?.n === "tag") || s[t.start - 1] === "#") {
      const j = s[t.start - 1] === "#" ? i : t.n === "hash" ? i + 2 : i + 1;
      const hit = at(j);
      if (hit) {
        const from = s[t.start - 1] === "#" ? t.start - 1 : t.start;
        return { text: s.slice(0, from) + " " + s.slice(toks[j + hit.k - 1].end), list: hit.list };
      }
    }
    if (PREPS.has(t.n)) {
      let j = i + 1;
      if (toks[j] && DETS.has(toks[j].n)) j++;
      const hit = at(j) ?? loose(j);
      if (hit) {
        let last = j + hit.k - 1;
        const noun = toks[last + 1] && LIST_NOUNS.has(toks[last + 1].n);
        if (noun) last++;
        if (noun || STRUCTURAL.test(s.slice(toks[last].end))) {
          return { text: s.slice(0, t.start) + " " + s.slice(toks[last].end), list: hit.list };
        }
      }
    }
    const hit = at(i);
    if (hit && (!bare || norm(hit.list.name).length > bare.len)) bare = { list: hit.list, len: norm(hit.list.name).length };
  }
  // In "log 2 hours hosa poster" the parser already reads the leading list name itself.
  if (bare && /^\s*log\s+\d/i.test(s)) return { text: s, list: null };
  return { text: s, list: bare?.list ?? null };
}

// ---- leftovers -------------------------------------------------------------------------------

function fillers(s: string): string {
  const LEAD = [
    /^\s*(?:hey|hi|ok(?:ay)?|so|alright|all\s+right|please|can\s+you|could\s+you|would\s+you|will\s+you|i\s+want\s+you\s+to|i\s+need\s+you\s+to|i'd\s+like\s+you\s+to|i\s+want\s+to|i'd\s+like\s+to|go\s+ahead\s+and|let's|and)\b\s*/i,
    /^\s*(?:add|create|make|put|set\s+up|new)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:task|to-?do|todo|item|reminder)\b(?:\s*:|\s+(?:called|named|titled|that\s+says|saying|to|for|about))?\s*/i,
    /^\s*schedule\s+(?:a|an|my)\s+/i,
    /^\s*(?:remind\s+me\s+to|remember\s+to|don't\s+forget\s+to|do\s+not\s+forget\s+to|make\s+sure\s+(?:to|i)|i\s+need\s+to|i\s+have\s+to|i've\s+got\s+to|i\s+got\s+to|i\s+gotta|gotta|i\s+should|i\s+must|need\s+to|have\s+to)\s+/i,
    /^\s*(?:i\s+have|i've\s+got|i\s+got|i\s+have\s+got|there's|there\s+is)\s+(?:a|an|my|the|this|that)\s+/i,
    /^\s*(?:i\s+have|i've\s+got)\s+(?=\S)/i,
    /^\s*my\s+/i,
  ];
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of LEAD) {
      const next = s.replace(r, " ");
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
  }
  s = s.replace(/\s+(?:please|thanks|thank\s+you|for\s+me|okay|ok|thx)\s*$/i, " ");
  // joining words stranded next to a token: "essay due friday and remind 1 hour", "and *"
  s = s.replace(/\b(?:and|also|then|plus|with)\s+(?=(?:remind|every|takes)\b|[!*](?:\s|$))/gi, " ");
  s = s.replace(/(?:^|\s)(?:and|also|then)\s*$/i, " ");
  // commas only get in the way of the parser's trailing-word cleanup
  return s.replace(/,/g, " ");
}

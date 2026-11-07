import { describe, expect, it } from "vitest";
import { parseQuickAdd, type ParsedEvent, type ParsedHours, type ParsedTask } from "@/lib/quickadd";
import { SEED_LISTS } from "@/lib/seed";

// Friday, Nov 6 2026, noon local
const NOW = new Date(2026, 10, 6, 12, 0);
const L = SEED_LISTS;
const id = (name: string) => L.find((l) => l.name === name)!.id;
const task = (s: string) => parseQuickAdd(s, L, NOW) as ParsedTask;
const ev = (s: string) => parseQuickAdd(s, L, NOW) as ParsedEvent;
const hrs = (s: string) => parseQuickAdd(s, L, NOW) as ParsedHours;
const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null);
const hm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("quick-add parser: tasks", () => {
  it("empty input", () => expect(parseQuickAdd("   ", L, NOW).kind).toBe("empty"));
  it("plain title has no date", () => {
    const t = task("buy poster board");
    expect(t.kind).toBe("task");
    expect(t.title).toBe("buy poster board");
    expect(t.due).toBeNull();
  });
  it("tomorrow is all-day", () => {
    const t = task("AP Psych essay tomorrow");
    expect(t.title).toBe("AP Psych essay");
    expect(ymd(t.due)).toBe("2026-11-7");
    expect(t.allDay).toBe(true);
  });
  it("date with time is not all-day", () => {
    const t = task("call mom at 5pm");
    expect(t.title).toBe("call mom");
    expect(hm(t.due!)).toBe("17:00");
    expect(t.allDay).toBe(false);
  });
  it("'due friday' said on a Friday means next Friday", () => {
    const t = task("essay due friday");
    expect(t.title).toBe("essay");
    expect(ymd(t.due)).toBe("2026-11-13");
  });
  it("weekday resolves forward", () => {
    expect(ymd(task("read ch 4 monday").due)).toBe("2026-11-9");
  });
  it("month day", () => {
    const t = task("submit form by nov 20");
    expect(t.title).toBe("submit form");
    expect(ymd(t.due)).toBe("2026-11-20");
  });
  it("numeric date with time", () => {
    const t = task("dentist 11/20 at 2pm");
    expect(ymd(t.due)).toBe("2026-11-20");
    expect(hm(t.due!)).toBe("14:00");
  });
  it("in N days", () => expect(ymd(task("project in 3 days").due)).toBe("2026-11-9"));
  it("next week weekday", () => expect(ymd(task("lab report next wednesday").due)).toBe("2026-11-11"));
  it("does not eat numbers in titles", () => {
    const t = task("read ch 5");
    expect(t.title).toBe("read ch 5");
    expect(t.due).toBeNull();
  });
  it("#list by exact name", () => {
    const t = task("poster draft #hosa tomorrow");
    expect(t.listId).toBe(id("HOSA"));
    expect(t.title).toBe("poster draft");
  });
  it("#list by prefix", () => expect(task("outreach #remember").listId).toBe(id("Remember Together")));
  it("#list with dash", () => expect(task("outreach #remember-together").listId).toBe(id("Remember Together")));
  it("#list by initials", () => expect(task("outreach #rt").listId).toBe(id("Remember Together")));
  it("unknown #list stays in the title", () => {
    const t = task("thing #nope");
    expect(t.listId).toBeNull();
  });
  it("star token", () => {
    const t = task("AP exam prep * may 5");
    expect(t.starred).toBe(true);
    expect(t.title).toBe("AP exam prep");
  });
  it("star glyph and flag", () => {
    const t = task("submit abstract ★ ! friday");
    expect(t.starred).toBe(true);
    expect(t.flagged).toBe(true);
    expect(t.title).toBe("submit abstract");
  });
  it("exclamation inside a word is kept", () => expect(task("wow! nice").title).toBe("wow! nice"));
  it("remind 1h is a custom reminder 1 hour before the due time", () => {
    const t = task("send email tomorrow 3pm remind 1h");
    expect(t.reminders).toEqual([{ kind: "offset", minutes: 60 }]);
    expect(t.title).toBe("send email");
  });
  it("remind 30 min", () => {
    expect(task("meet advisor today 4pm remind 30 min").reminders).toEqual([{ kind: "offset", minutes: 30 }]);
  });
  it("remind 1 day before an all-day task stays relative to the due day", () => {
    const t = task("paper due nov 20 remind 1 day");
    expect(t.allDay).toBe(true);
    expect(t.reminders).toEqual([{ kind: "offset", minutes: 1440 }]);
  });
  it("remind at a clock time lands on the due day", () => {
    const t = task("hw due monday remind 8pm");
    expect(t.reminders).toHaveLength(1);
    const r = t.reminders[0] as { kind: "at"; at: string };
    expect(r.kind).toBe("at");
    expect(ymd(new Date(r.at))).toBe("2026-11-9");
    expect(hm(new Date(r.at))).toBe("20:00");
  });
  it("several remind tokens each add a reminder", () => {
    const t = task("essay due monday 5pm remind 1h remind 1 day remind 8am");
    expect(t.title).toBe("essay");
    expect(t.reminders.filter((r) => r.kind === "offset")).toEqual([
      { kind: "offset", minutes: 60 },
      { kind: "offset", minutes: 1440 },
    ]);
    const exact = t.reminders.filter((r) => r.kind === "at") as { kind: "at"; at: string }[];
    expect(exact).toHaveLength(1);
    expect(hm(new Date(exact[0].at))).toBe("8:00");
    expect(ymd(new Date(exact[0].at))).toBe("2026-11-9");
  });
  it("duplicate remind tokens collapse", () => {
    expect(task("call tomorrow 3pm remind 1h remind 60 min").reminders).toEqual([{ kind: "offset", minutes: 60 }]);
  });
  it("with no due date, remind 2h means two hours from now", () => {
    const t = task("check oven remind 2h");
    expect(t.due).toBeNull();
    expect(t.reminders).toHaveLength(1);
    expect(new Date((t.reminders[0] as { at: string }).at).getTime()).toBe(NOW.getTime() + 2 * 3600_000);
  });
  it("no remind token means no custom reminders", () => expect(task("essay tomorrow").reminders).toEqual([]));
  it("events keep the first remind offset", () => {
    expect(ev("lab meeting tomorrow 3-4pm remind 15m remind 1h").remindOffset).toBe(15);
  });
  it("every day", () => {
    const t = task("take vitamins every day");
    expect(t.rrule).toBe("RRULE:FREQ=DAILY");
    expect(t.title).toBe("take vitamins");
    expect(ymd(t.due)).toBe("2026-11-6");
  });
  it("every tue", () => {
    const t = task("hosa meeting every tue");
    expect(t.rrule).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU");
    expect(t.title).toBe("hosa meeting");
  });
  it("multiple days", () => expect(task("practice every mon, wed and fri").rrule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"));
  it("every weekday", () => expect(task("check inbox every weekday").rrule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"));
  it("monthly", () => expect(task("pay club dues monthly").rrule).toBe("RRULE:FREQ=MONTHLY"));
  it("repeat with end", () => {
    const t = task("journal daily until dec 15");
    expect(t.rrule).toBe("RRULE:FREQ=DAILY;UNTIL=20261215T235959Z");
    expect(t.title).toBe("journal");
  });
});

describe("quick-add parser: reminders on a named day", () => {
  // NOW is Fri Nov 6 2026, 12:00
  const at = (s: string) => (task(s).reminders.filter((r) => r.kind === "at") as { kind: "at"; at: string }[]).map((r) => new Date(r.at));
  it.each([
    ["essay fri 9pm remind thu 7pm", "2026-11-12", "19:00"],
    ["essay fri 9pm remind 7pm thu", "2026-11-12", "19:00"],
    ["essay fri 9pm remind 7pm on thursday", "2026-11-12", "19:00"],
    ["essay fri 9pm remind tomorrow 8am", "2026-11-7", "8:00"],
    ["essay remind wed 6:30pm", "2026-11-11", "18:30"],
  ])("%s", (input, day, time) => {
    const t = task(input);
    expect(t.title).toBe("essay");
    const r = at(input);
    expect(r).toHaveLength(1);
    expect(ymd(r[0])).toBe(day);
    expect(hm(r[0])).toBe(time);
  });
  it("mixes with offsets and keeps the hint example working", () => {
    const t = task("essay fri 9pm remind 1h remind thu 7pm");
    expect(t.title).toBe("essay");
    expect(t.reminders).toHaveLength(2);
  });
  it("a bare time still fires on the due day", () => {
    const r = at("hw due monday remind 8pm");
    expect(ymd(r[0])).toBe("2026-11-9");
  });
});

describe("quick-add parser: events", () => {
  it("time range makes an event", () => {
    const e = ev("hosa meeting tomorrow 3-4pm #hosa");
    expect(e.kind).toBe("event");
    expect(e.title).toBe("hosa meeting");
    expect(hm(e.start)).toBe("15:00");
    expect(hm(e.end)).toBe("16:00");
    expect(e.listId).toBe(id("HOSA"));
  });
  it("3pm to 4:30pm on monday", () => {
    const e = ev("study 3pm to 4:30pm on monday");
    expect(e.kind).toBe("event");
    expect(hm(e.end)).toBe("16:30");
    expect(ymd(e.start)).toBe("2026-11-9");
  });
  it("sat 10am-12pm", () => {
    const e = ev("olympiad practice sat 10am-12pm");
    expect(e.kind).toBe("event");
    expect(ymd(e.start)).toBe("2026-11-7");
  });
  it("repeating event", () => expect(ev("club meeting every tue 3-4pm").rrule).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU"));
  it("a weekly repeat starts on its next listed weekday", () => {
    const e = ev("club meeting every tue 3-4pm");
    expect(ymd(e.start)).toBe("2026-11-10");
    expect(hm(e.start)).toBe("15:00");
    expect(hm(e.end)).toBe("16:00");
    expect(ymd(task("hosa meeting every tue").due)).toBe("2026-11-10");
  });
  it("#list matches any word in the name", () => {
    expect(task("review ch 3 #psych").listId).toBe(id("AP Psych"));
    expect(task("poster #together").listId).toBe(id("Remember Together"));
  });
});

describe("quick-add parser: hours", () => {
  it("log 2h hosa poster", () => {
    const h = hrs("log 2h hosa poster");
    expect(h.kind).toBe("hours");
    expect(h.hours).toBe(2);
    expect(h.listId).toBe(id("HOSA"));
    expect(h.note).toBe("poster");
    expect(ymd(h.date)).toBe("2026-11-6");
  });
  it("minutes convert to hours", () => expect(hrs("log 90 min olympiad problem set").hours).toBe(1.5));
  it("decimal and #list and yesterday", () => {
    const h = hrs("log 1.5h #research lit review yesterday");
    expect(h.hours).toBe(1.5);
    expect(h.listId).toBe(id("Research"));
    expect(h.note).toBe("lit review");
    expect(ymd(h.date)).toBe("2026-11-5");
  });
  it("multi-word list name", () => {
    const h = hrs("log 1h remember together flyers");
    expect(h.listId).toBe(id("Remember Together"));
    expect(h.note).toBe("flyers");
  });
});

describe("quick-add parser: takes", () => {
  it.each([
    ["essay at 3pm takes 1h", 60],
    ["essay at 3pm takes 45m", 45],
    ["essay at 3pm takes 1h30m", 90],
    ["essay at 3pm takes 90 min", 90],
    ["essay at 3pm takes 1.5 hours", 90],
    ["essay at 3pm takes 2 hrs", 120],
    ["essay at 3pm takes 1h 15m", 75],
    ["essay at 3pm takes 20", 20],
  ])("%s", (input, mins) => {
    const t = task(input);
    expect(t.kind).toBe("task");
    expect(t.durationMin).toBe(mins);
    expect(t.title).toBe("essay");
    expect(hm(t.due!)).toBe("15:00");
  });
  it("works anywhere in the sentence and next to other tokens", () => {
    const t = task("takes 1h essay #ap-psych fri 3pm remind 30m");
    expect(t.durationMin).toBe(60);
    expect(t.title).toBe("essay");
    expect(t.listId).toBe(id("AP Psych"));
    expect(t.reminders).toEqual([{ kind: "offset", minutes: 30 }]);
  });
  it("doesn't swallow a following time", () => {
    const t = task("study takes 1h 3pm");
    expect(t.durationMin).toBe(60);
    expect(hm(t.due!)).toBe("15:00");
  });
  it("is null when absent, and ignores nonsense lengths", () => {
    expect(task("essay at 3pm").durationMin).toBeNull();
    expect(task("essay takes 0m").durationMin).toBeNull();
    expect(task("essay takes 30h").durationMin).toBeNull();
  });
});

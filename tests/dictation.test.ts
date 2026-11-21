import { describe, expect, it } from "vitest";
import { normalizeDictation, pickAlternative } from "@/lib/dictation";
import { parseQuickAdd, type Parsed, type ParsedEvent, type ParsedHours, type ParsedTask } from "@/lib/quickadd";
import { SEED_LISTS } from "@/lib/seed";

// Friday, Nov 6 2026, noon local
const NOW = new Date(2026, 10, 6, 12, 0);
const L = SEED_LISTS;
const id = (name: string) => L.find((l) => l.name === name)!.id;
const say = (s: string): Parsed => parseQuickAdd(normalizeDictation(s, L, NOW), L, NOW);
const task = (s: string) => say(s) as ParsedTask;
const ev = (s: string) => say(s) as ParsedEvent;
const hrs = (s: string) => say(s) as ParsedHours;
const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null);
const hm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("dictation: tasks", () => {
  it.each<[string, string, string | null, string | null, string | null]>([
    // transcript, title, day, time (null = all day), list
    ["AP Psych essay is due Monday at 9 p.m.", "AP Psych essay", "2026-11-9", "21:00", "AP Psych"],
    ["Essay due Monday at nine PM", "Essay", "2026-11-9", "21:00", null],
    ["Call mom at 5", "Call mom", "2026-11-6", "17:00", null],
    ["Call mom at five o'clock", "Call mom", "2026-11-6", "17:00", null],
    ["call the dentist tomorrow at 10", "call the dentist", "2026-11-7", "10:00", null],
    ["Turn in the permission slip by 8 tomorrow", "Turn in the permission slip", "2026-11-7", "20:00", null],
    ["submit the lab report tomorrow morning at 8", "submit the lab report", "2026-11-7", "8:00", null],
    ["Study for the psych test tonight at 8", "Study for the psych test", "2026-11-6", "20:00", null],
    ["I need to finish my essay by midnight on Sunday", "finish my essay", "2026-11-8", "23:59", null],
    ["Read chapter 5 for AP Psych by Monday", "Read chapter 5", "2026-11-9", null, "AP Psych"],
    ["read chapter one", "read chapter one", null, null, null],
    ["Remind me to email Mr. Lee at 4:30", "email Mr. Lee", "2026-11-6", "16:30", null],
    ["Add a task to buy poster board tomorrow", "buy poster board", "2026-11-7", null, null],
    ["Don't forget to bring the calculator on Monday", "bring the calculator", "2026-11-9", null, null],
    ["My college essay draft is due on the 20th", "college essay draft", "2026-11-20", null, null],
    ["scholarship application due on the third", "scholarship application", "2026-12-3", null, null],
    ["Olympiad problem set due November twentieth", "Olympiad problem set", "2026-11-20", null, "Olympiad"],
    ["the deadline for the hackathon signup is next Wednesday", "the hackathon signup", "2026-11-11", null, "Hackathons"],
    ["Pick up flyers for Remember Together on Thursday", "Pick up flyers", "2026-11-12", null, "Remember Together"],
    ["HOSA poster due Tuesday at 3:30", "HOSA poster", "2026-11-10", "15:30", "HOSA"],
    ["water the plants in 3 days", "water the plants", "2026-11-9", null, null],
    ["Return library books in two weeks", "Return library books", "2026-11-20", null, null],
    ["Lunch with Sam at noon tomorrow", "Lunch with Sam", "2026-11-7", "12:00", null],
    ["Practice violin at 7 in the morning on Saturday", "Practice violin", "2026-11-7", "7:00", null],
    ["Finish slides at quarter past three", "Finish slides", "2026-11-6", "15:15", null],
    ["Finish slides at half past 3", "Finish slides", "2026-11-6", "15:30", null],
    ["leave for the airport at quarter to six", "leave for the airport", "2026-11-6", "17:45", null],
    ["Call grandma at nine thirty tonight", "Call grandma", "2026-11-6", "21:30", null],
    ["SAT on December 5th at 8 a.m.", "SAT", "2026-12-5", "8:00", null],
    ["Physics homework due tomorrow at 11:59 PM", "Physics homework", "2026-11-7", "23:59", null],
    ["Meeting with my counselor on Monday at 10:30 in the morning", "Meeting with my counselor", "2026-11-9", "10:30", null],
    ["Submit the HOSA registration form by the 15th", "Submit the HOSA registration form", "2026-11-15", null, "HOSA"],
    ["Need to email Dr. Patel about the internship by Friday", "email Dr. Patel about the internship", "2026-11-13", null, null],
    ["Dinner with family at 6:30 tonight", "Dinner with family", "2026-11-6", "18:30", null],
    ["Essay due on Monday at 8 am for AP Psych", "Essay", "2026-11-9", "8:00", "AP Psych"],
    ["Okay so add a task called review notes for psych class tomorrow", "review notes", "2026-11-7", null, "AP Psych"],
  ])("%s", (said, title, day, time, list) => {
    const t = task(said);
    expect(t.kind).toBe("task");
    expect(t.title).toBe(title);
    expect(ymd(t.due)).toBe(day);
    if (time) {
      expect(t.allDay).toBe(false);
      expect(hm(t.due!)).toBe(time);
    } else expect(t.allDay).toBe(true);
    expect(t.listId).toBe(list ? id(list) : null);
  });

  it("a list named in the middle of the title files it without cutting the title", () => {
    const t = task("Study for AP Psych test tomorrow");
    expect(t.title).toBe("Study for AP Psych test");
    expect(t.listId).toBe(id("AP Psych"));
  });
  it("AP Psychology and spelled-out letters still find AP Psych", () => {
    expect(task("Unit 3 notes for AP Psychology").listId).toBe(id("AP Psych"));
    expect(task("flashcards for a p psych").listId).toBe(id("AP Psych"));
    expect(task("Poster for H O S A").listId).toBe(id("HOSA"));
  });
  it("hashtag and list phrases", () => {
    expect(task("buy tape hashtag HOSA").listId).toBe(id("HOSA"));
    expect(task("buy tape hashtag HOSA").title).toBe("buy tape");
    expect(task("buy tape #HOSA").listId).toBe(id("HOSA"));
    const t = task("Put order snacks in my Remember Together list");
    expect(t.listId).toBe(id("Remember Together"));
    expect(t.title).toBe("Put order snacks");
  });
  it("a misheard list name one letter off still matches", () => {
    expect(task("practice problems for olympiads").listId).toBe(id("Olympiad"));
    expect(task("lit review for reserch").listId).toBe(id("Research"));
  });
  it("chapter ranges are not times", () => {
    const t = task("read chapters 3 to 4");
    expect(t.kind).toBe("task");
    expect(t.title).toBe("read chapters 3\u20114");
  });
});

describe("dictation: reminders", () => {
  it.each<[string, number[]]>([
    ["Essay due Friday at 9pm remind me an hour before", [60]],
    ["Essay due Friday at 9pm, remind me one hour before it's due", [60]],
    ["Essay due Friday at 9pm and remind me 30 minutes before", [30]],
    ["Essay due Friday at 9pm set a reminder for 2 hours before", [120]],
    ["Essay due Friday at 9pm remind me a day before and an hour before", [1440, 60]],
    ["Essay due Friday remind me the day before", [1440]],
    ["Essay due Friday remind me the night before", [1440]],
    ["Essay due Friday at 9pm alert me half an hour before", [30]],
    ["Essay due Friday at 9pm remind me an hour and a half before", [90]],
    ["Essay due Friday at 9pm with a reminder 15 minutes ahead of time", [15]],
  ])("%s", (said, offsets) => {
    const t = task(said);
    expect(t.title).toBe("Essay");
    expect(t.reminders.filter((r) => r.kind === "offset").map((r) => (r as { minutes: number }).minutes)).toEqual(offsets);
  });
  it.each<[string, string, string]>([
    ["Essay due Friday at 9pm remind me Thursday at 7", "2026-11-12", "19:00"],
    ["Essay due Friday at 9pm remind me on Thursday at 7 p.m.", "2026-11-12", "19:00"],
    ["Essay due Friday remind me Thursday night", "2026-11-12", "19:00"],
    ["Essay due Friday remind me tomorrow morning", "2026-11-7", "8:00"],
    ["Essay due Monday remind me at 8 p.m.", "2026-11-9", "20:00"],
    ["Essay due Monday remind me on Sunday", "2026-11-8", "8:00"],
  ])("%s", (said, day, time) => {
    const t = task(said);
    expect(t.title).toBe("Essay");
    const at = t.reminders.filter((r) => r.kind === "at").map((r) => new Date((r as { at: string }).at));
    expect(at).toHaveLength(1);
    expect(ymd(at[0])).toBe(day);
    expect(hm(at[0])).toBe(time);
  });
  it("remind me in 2 hours with no due date", () => {
    const t = task("check the oven remind me in two hours");
    expect(t.title).toBe("check the oven");
    expect(new Date((t.reminders[0] as { at: string }).at).getTime()).toBe(NOW.getTime() + 2 * 3600_000);
  });
});

describe("dictation: events", () => {
  it.each<[string, string, string, string, string, string | null]>([
    ["HOSA meeting tomorrow from 3 to 4", "HOSA meeting", "2026-11-7", "15:00", "16:00", "HOSA"],
    ["HOSA meeting tomorrow from three to four pm", "HOSA meeting", "2026-11-7", "15:00", "16:00", "HOSA"],
    ["I have a HOSA meeting on Tuesday from 3:30 to 5", "HOSA meeting", "2026-11-10", "15:30", "17:00", "HOSA"],
    ["study group Thursday between 2 and 3 pm", "study group", "2026-11-12", "14:00", "15:00", null],
    ["Olympiad practice Saturday from 10 to 12", "Olympiad practice", "2026-11-7", "10:00", "12:00", "Olympiad"],
    ["Olympiad practice Saturday from 11 to 1", "Olympiad practice", "2026-11-7", "11:00", "13:00", "Olympiad"],
    ["Volunteer shift Sunday from 9 to 5", "Volunteer shift", "2026-11-8", "9:00", "17:00", null],
    ["Robotics Monday 6 to 8", "Robotics", "2026-11-9", "18:00", "20:00", null],
    ["Team call Monday 3 p.m. to 4:30 p.m.", "Team call", "2026-11-9", "15:00", "16:30", null],
    ["Team call Monday at 3pm for an hour", "Team call", "2026-11-9", "15:00", "16:00", null],
    ["Team call Monday at 3 for 45 minutes", "Team call", "2026-11-9", "15:00", "15:45", null],
    ["Tutoring tomorrow at 4 for an hour and a half", "Tutoring", "2026-11-7", "16:00", "17:30", null],
    ["Add an event dentist appointment Wednesday at 2", "dentist appointment", "2026-11-11", "14:00", "15:00", null],
    ["Put the research meeting on my calendar for Thursday at 11", "the research meeting", "2026-11-12", "11:00", "12:00", "Research"],
    ["hackathon kickoff tomorrow from 7 to 9 at night", "hackathon kickoff", "2026-11-7", "19:00", "21:00", "Hackathons"],
  ])("%s", (said, title, day, start, end, list) => {
    const e = ev(said);
    expect(e.kind).toBe("event");
    expect(e.title).toBe(title);
    expect(ymd(e.start)).toBe(day);
    expect(hm(e.start)).toBe(start);
    expect(hm(e.end)).toBe(end);
    expect(e.listId).toBe(list ? id(list) : null);
  });
  it("event reminder", () => {
    expect(ev("HOSA meeting tomorrow from 3 to 4 remind me 15 minutes before").remindOffset).toBe(15);
  });
});

describe("dictation: repeats", () => {
  it.each<[string, string, string]>([
    ["Club meeting every Tuesday from 3 to 4", "Club meeting", "RRULE:FREQ=WEEKLY;BYDAY=TU"],
    ["Piano on Tuesdays and Thursdays at 5", "Piano", "RRULE:FREQ=WEEKLY;BYDAY=TU,TH"],
    ["Practice every Monday Wednesday and Friday at 6", "Practice", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"],
    ["check email every weekday at 8", "check email", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    ["take vitamins every morning", "take vitamins", "RRULE:FREQ=DAILY"],
    ["take vitamins each day", "take vitamins", "RRULE:FREQ=DAILY"],
    ["Pay club dues once a month", "Pay club dues", "RRULE:FREQ=MONTHLY"],
    ["Journal every day until December 15th", "Journal", "RRULE:FREQ=DAILY;UNTIL=20261215T235959Z"],
  ])("%s", (said, title, rrule) => {
    const p = say(said) as ParsedTask | ParsedEvent;
    expect(p.title).toBe(title);
    expect(p.rrule).toBe(rrule);
  });
  it("times on a repeat get the right half of the day", () => {
    const t = task("Piano on Tuesdays and Thursdays at 5");
    expect(hm(t.due!)).toBe("17:00");
    expect(ymd(t.due)).toBe("2026-11-10");
  });
});

describe("dictation: takes, star, flag", () => {
  it("it'll take an hour", () => {
    const t = task("Write the essay Saturday at 2 it'll take about an hour");
    expect(t.title).toBe("Write the essay");
    expect(t.durationMin).toBe(60);
    expect(hm(t.due!)).toBe("14:00");
  });
  it("takes forty five minutes", () => expect(task("Problem set tomorrow at 4 takes forty five minutes").durationMin).toBe(45));
  it("takes 1 hour and 30 minutes", () => expect(task("Problem set tomorrow at 4 it should take 1 hour and 30 minutes").durationMin).toBe(90));
  it("for 2 hours with no time is how long it takes", () => {
    const t = task("study for 2 hours tomorrow");
    expect(t.title).toBe("study");
    expect(t.durationMin).toBe(120);
    expect(t.allDay).toBe(true);
  });
  it("flag phrases", () => {
    for (const said of ["Essay due Friday mark it as important", "Essay due Friday it's urgent", "Essay due Friday and flag it", "Essay due Friday high priority", "Essay due Friday important"]) {
      const t = task(said);
      expect(t.flagged, said).toBe(true);
      expect(t.title, said).toBe("Essay");
    }
  });
  it("countdown phrases", () => {
    for (const said of ["AP exam May 5th add a countdown", "AP exam May 5th star it", "AP exam May 5th with a countdown", "AP exam May 5th countdown"]) {
      const t = task(said);
      expect(t.starred, said).toBe(true);
      expect(t.title, said).toBe("AP exam");
      expect(ymd(t.due), said).toBe("2027-5-5");
    }
  });
  it("important inside a title is kept", () => {
    const t = task("print the important forms tomorrow");
    expect(t.flagged).toBe(false);
    expect(t.title).toBe("print the important forms");
  });
});

describe("dictation: hours", () => {
  it.each<[string, number, string | null, string, string]>([
    ["log two hours HOSA poster", 2, "HOSA", "poster", "2026-11-6"],
    ["I spent 2 hours on the HOSA poster yesterday", 2, "HOSA", "poster", "2026-11-5"],
    ["I worked an hour and a half on research lit review", 1.5, "Research", "lit review", "2026-11-6"],
    ["log 45 minutes for Olympiad problems", 0.75, "Olympiad", "problems", "2026-11-6"],
    ["logged half an hour of Remember Together flyers", 0.5, "Remember Together", "flyers", "2026-11-6"],
  ])("%s", (said, hours, list, note, day) => {
    const h = hrs(said);
    expect(h.kind).toBe("hours");
    expect(h.hours).toBe(hours);
    expect(h.listId).toBe(list ? id(list) : null);
    expect(h.note).toBe(note);
    expect(ymd(h.date)).toBe(day);
  });
});

describe("dictation: odds and ends", () => {
  it("empty and filler-only input", () => {
    expect(normalizeDictation("   ", L, NOW)).toBe("");
    expect(say("").kind).toBe("empty");
  });
  it("typed syntax parses the same either way", () => {
    for (const typed of ["essay due fri 9pm #ap-psych remind 1h", "study group thu 3-4pm", "log 2h hosa poster", "AP exam prep * may 5 !", "essay at 3pm takes 1h30m every tue"])
      expect(say(typed), typed).toEqual(parseQuickAdd(typed, L, NOW));
  });
  it("tonight after a time names the day", () => {
    const t = task("Call grandma at 8 tonight");
    expect(t.title).toBe("Call grandma");
    expect(ymd(t.due)).toBe("2026-11-6");
    expect(hm(t.due!)).toBe("20:00");
  });
  it("works with no lists", () => {
    const t = parseQuickAdd(normalizeDictation("HOSA meeting at 3", [], NOW), [], NOW) as ParsedTask;
    expect(t.title).toBe("HOSA meeting");
    expect(hm(t.due!)).toBe("15:00");
  });
  it("a morning time that has already passed today means this evening", () => {
    expect(hm(task("call Sam at 9").due!)).toBe("21:00");
    expect(ymd(task("call Sam at 9").due)).toBe("2026-11-6");
  });
  it("pickAlternative prefers an alternative that names a list", () => {
    expect(pickAlternative(["poster for hoser", "poster for HOSA"], L)).toBe("poster for HOSA");
    expect(pickAlternative(["poster for HOSA", "poster for hosta"], L)).toBe("poster for HOSA");
    expect(pickAlternative(["buy milk", "by milk"], L)).toBe("buy milk");
  });
});

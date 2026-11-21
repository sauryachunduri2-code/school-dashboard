import { describe, expect, it, vi } from "vitest";
import { bearerOwner } from "@/lib/brief/auth";
import { makeBrief } from "@/lib/brief/brief";
import { buildFacts } from "@/lib/brief/facts";
import { geminiProse, parseProse, promptFacts } from "@/lib/brief/gemini";
import { ruleProse } from "@/lib/brief/rules";
import { dayBounds, zonedMidnight, zonedYmd } from "@/lib/brief/zone";
import { newTask } from "@/lib/tasks";
import type { GEvent, List } from "@/lib/types";

// lib/env reads these when it loads; bearer auth is off without them.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://x.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon";
});

const TZ = "America/New_York";
// Thursday 2026-11-19, 6:30 AM in New York (11:30 UTC).
const NOW = new Date("2026-11-19T11:30:00Z");
const ny = (time: string, day = 19) => new Date(`2026-11-${day}T${time}:00-05:00`).toISOString();
const ev = (over: Partial<GEvent>): GEvent => ({
  id: "e", calendar_id: "c", summary: "Meet", description: "secret notes", start: ny("08:05"), end: ny("09:00"), all_day: false, etag: "x",
  recurring_event_id: null, recurrence: null, list_id: null, starred: false, flagged: false, todo: false, reminders: [], read_only: false, ...over,
});
const lists: List[] = [{ id: "chem", area: "school", name: "AP Chem", color: "#f00", sort: 0 }];

describe("zone", () => {
  it("finds local midnight in the owner's zone, across DST", () => {
    expect(zonedMidnight("2026-11-19", TZ).toISOString()).toBe("2026-11-19T05:00:00.000Z");
    expect(zonedMidnight("2026-07-04", TZ).toISOString()).toBe("2026-07-04T04:00:00.000Z");
    const { from, to } = dayBounds("2026-11-01", TZ); // DST ends: a 25-hour day
    expect((+to - +from) / 3600_000).toBe(25);
    expect(zonedYmd(new Date("2026-11-20T03:00:00Z"), TZ)).toBe("2026-11-19");
  });
});

describe("brief facts", () => {
  const tasks = [
    newTask({ id: "lab", title: "Chem lab report", due_at: ny("23:59"), list_id: "chem" }),
    newTask({ id: "read", title: "Read ch. 5", due_at: zonedMidnight("2026-11-19", TZ).toISOString(), all_day: true }),
    newTask({ id: "late", title: "Essay draft", due_at: ny("23:59", 17) }),
    newTask({ id: "older", title: "Permission slip", due_at: ny("12:00", 12) }),
    newTask({ id: "exam", title: "AP Chem unit test", due_at: zonedMidnight("2026-11-21", TZ).toISOString(), all_day: true, starred: true }),
    newTask({ id: "done", title: "Done thing", due_at: ny("10:00"), completed_at: ny("06:00") }),
    newTask({ id: "far", title: "Far away", due_at: ny("10:00", 30), starred: true }),
  ];
  const events = [
    ev({ id: "class", summary: "AP Chem", start: ny("08:05"), end: ny("09:00"), list_id: "chem" }),
    ev({ id: "hosa", summary: "HOSA meeting", start: ny("15:30"), end: ny("16:30") }),
    ev({ id: "early", summary: "Bus", start: ny("06:00"), end: ny("06:15") }),
    ev({ id: "allday", summary: "Spirit week", all_day: true, start: "2026-11-17", end: "2026-11-21" }),
    ev({ id: "tomorrow", summary: "Dentist", start: ny("09:00", 20), end: ny("10:00", 20), flagged: true }),
  ];
  const f = buildFacts({ tasks, events, lists, now: NOW, tz: TZ });

  it("lists today's items, all-day first, then by time, with local clock times and list names", () => {
    expect(f.date).toBe("2026-11-19");
    expect(f.weekday).toBe("Thursday");
    expect(f.today.map((i) => i.title)).toEqual(["Spirit week", "Read ch. 5", "Bus", "AP Chem", "HOSA meeting", "Chem lab report"]);
    const chem = f.today.find((i) => i.title === "AP Chem")!;
    expect([chem.time, chem.endTime, chem.list]).toEqual(["8:05 AM", "9:00 AM", "AP Chem"]);
  });

  it("next is the first timed thing that hasn't started", () => {
    expect(f.next?.title).toBe("AP Chem");
  });

  it("overdue is open tasks before today, oldest first; completed tasks never show", () => {
    expect(f.overdue.map((i) => i.title)).toEqual(["Permission slip", "Essay draft"]);
    expect(JSON.stringify(f)).not.toContain("Done thing");
  });

  it("upcoming is starred or flagged in the next week, with days away", () => {
    expect(f.upcoming.map((i) => [i.title, i.daysAway])).toEqual([["Dentist", 1], ["AP Chem unit test", 2]]);
  });

  it("free blocks are 45+ minute gaps from now to 10 PM", () => {
    expect(f.free.map((b) => `${b.time}-${b.endTime}`)).toEqual(["6:30 AM-8:05 AM", "9:00 AM-3:30 PM", "4:30 PM-10:00 PM"]);
  });

  it("never sends notes or descriptions to the model", () => {
    const text = JSON.stringify(promptFacts(f));
    expect(text).not.toContain("secret notes");
    expect(text).toContain("AP Chem");
  });
});

describe("rule prose", () => {
  it("names the first thing, overdue work and what's coming", () => {
    const f = buildFacts({
      tasks: [newTask({ title: "Essay draft", due_at: ny("23:59", 17) })],
      events: [ev({ summary: "AP Chem", start: ny("08:05"), end: ny("09:00") }), ev({ id: "d", summary: "Dentist", flagged: true, start: ny("09:00", 20), end: ny("10:00", 20) })],
      lists, now: NOW, tz: TZ,
    });
    const p = ruleProse(f);
    expect(p.headline).toBe("First up: AP Chem at 8:05 AM");
    expect(p.summary).toBe("Thursday: 1 event today. 1 overdue task, starting with Essay draft. Coming up: Dentist tomorrow.");
    expect(p.focus).toBe("You're free 6:30 AM–8:05 AM: a good time for Essay draft.");
  });
  it("an empty day reads as open", () => {
    const p = ruleProse(buildFacts({ tasks: [], events: [], lists, now: NOW, tz: TZ }));
    expect(p).toEqual({ headline: "Nothing scheduled this Thursday", summary: "Your Thursday is open.", focus: null });
  });
});

describe("gemini", () => {
  const facts = buildFacts({ tasks: [], events: [ev({})], lists, now: NOW, tz: TZ });
  const reply = (text: string, status = 200) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });

  it("asks for JSON with the key in a header, not the URL", async () => {
    const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => args && reply(JSON.stringify({ headline: "Chem at 8:05", summary: "A light day.", focus: null })));
    const prose = await geminiProse(facts, { apiKey: "k", model: "gemini-test", fetch: fetchMock });
    expect(prose).toEqual({ headline: "Chem at 8:05", summary: "A light day.", focus: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(url).not.toContain("k=");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
    const body = JSON.parse(init!.body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.contents[0].parts[0].text).toContain("Meet");
  });

  it("rejects a malformed or empty answer and trims long ones", () => {
    expect(() => parseProse("not json")).toThrow();
    expect(parseProse('```json\n{"headline":"H","summary":"S","focus":null}\n```').headline).toBe("H");
    expect(() => parseProse(JSON.stringify({ headline: "", summary: "x" }))).toThrow();
    const long = parseProse(JSON.stringify({ headline: "h".repeat(200), summary: "s", focus: "  " }));
    expect(long.headline.length).toBe(70);
    expect(long.focus).toBeNull();
  });

  it("an HTTP error throws so the caller falls back", async () => {
    await expect(geminiProse(facts, { apiKey: "k", fetch: async () => new Response("quota", { status: 429 }) })).rejects.toThrow("gemini 429");
  });
});

describe("makeBrief", () => {
  const base = { tasks: [], events: [ev({})], lists, now: NOW, tz: TZ, calendar: "ok" as const };
  it("uses the writer when it works", async () => {
    const b = await makeBrief({ ...base, writer: async () => ({ headline: "H", summary: "S", focus: "F" }) });
    expect([b.source, b.headline, b.next?.title, b.date]).toEqual(["gemini", "H", "Meet", "2026-11-19"]);
  });
  it("falls back to the rules when the writer fails or is missing", async () => {
    const log = vi.fn();
    const failed = await makeBrief({ ...base, writer: async () => { throw new Error("boom"); }, log });
    expect(failed.source).toBe("rules");
    expect(failed.headline).toBe("First up: Meet at 8:05 AM");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect((await makeBrief(base)).source).toBe("rules");
  });
});

describe("bearer auth", () => {
  const req = (auth?: string) => new Request("https://daybook.example/api/rise/brief", { headers: auth ? { authorization: auth } : {} });
  const client = (email: string | null, error: unknown = null) =>
    (() => ({ auth: { getClaims: async () => ({ data: email ? { claims: { email } } : null, error }) } })) as never;

  it("lets only the owner's token through", async () => {
    expect(await bearerOwner(req("Bearer t"), client("SauryaChunduri2@gmail.com"))).not.toBeNull();
    expect(await bearerOwner(req("Bearer t"), client("someone@else.com"))).toBeNull();
    expect(await bearerOwner(req("Bearer t"), client(null, { message: "bad jwt" }))).toBeNull();
    expect(await bearerOwner(req(), client("sauryachunduri2@gmail.com"))).toBeNull();
    expect(await bearerOwner(req("Basic abc"), client("sauryachunduri2@gmail.com"))).toBeNull();
  });
});

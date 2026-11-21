import { describe, expect, it } from "vitest";
import { freeGaps, tonightCapacity } from "@/lib/free";
import { newTask } from "@/lib/tasks";
import type { GEvent, Task } from "@/lib/types";

// Thu Nov 19 2026, 2:00 PM local. Built with local-time constructors so the tests hold in any zone.
const NOW = new Date(2026, 10, 19, 14, 0);
const at = (h: number, m = 0, day = 19) => new Date(2026, 10, day, h, m);
const iso = (d: Date) => d.toISOString();
const span = (s: Date, e: Date) => ({ start: s, end: e });
const hm = (gaps: { start: Date; end: Date }[]) => gaps.map((g) => `${g.start.getHours()}:${String(g.start.getMinutes()).padStart(2, "0")}-${g.end.getHours()}:${String(g.end.getMinutes()).padStart(2, "0")}`);

describe("freeGaps", () => {
  const from = at(8);
  const to = at(12);

  it("returns the whole window when nothing is busy", () => {
    expect(freeGaps([], from, to, 45)).toEqual([{ start: from, end: to, minutes: 240 }]);
  });

  it("splits the window around a busy span", () => {
    const gaps = freeGaps([span(at(9), at(10))], from, to, 15);
    expect(hm(gaps)).toEqual(["8:00-9:00", "10:00-12:00"]);
    expect(gaps.map((g) => g.minutes)).toEqual([60, 120]);
  });

  it("merges overlapping busy spans", () => {
    const gaps = freeGaps([span(at(9), at(10)), span(at(9, 30), at(11))], from, to, 15);
    expect(hm(gaps)).toEqual(["8:00-9:00", "11:00-12:00"]);
  });

  it("handles nested busy spans", () => {
    const gaps = freeGaps([span(at(9), at(12)), span(at(10), at(11))], from, to, 15);
    expect(hm(gaps)).toEqual(["8:00-9:00"]);
  });

  it("treats adjacent busy spans as one block", () => {
    const gaps = freeGaps([span(at(9), at(10)), span(at(10), at(11))], from, to, 15);
    expect(hm(gaps)).toEqual(["8:00-9:00", "11:00-12:00"]);
  });

  it("ignores busy spans outside the window", () => {
    expect(freeGaps([span(at(6), at(7)), span(at(13), at(14))], from, to, 45)).toEqual([{ start: from, end: to, minutes: 240 }]);
  });

  it("clips a busy span that starts before the window", () => {
    expect(hm(freeGaps([span(at(7), at(9))], from, to, 15))).toEqual(["9:00-12:00"]);
  });

  it("clips a busy span that runs past the window", () => {
    expect(hm(freeGaps([span(at(11), at(15))], from, to, 15))).toEqual(["8:00-11:00"]);
  });

  it("returns nothing when busy covers the window", () => {
    expect(freeGaps([span(at(7), at(13))], from, to, 15)).toEqual([]);
  });

  it("drops gaps shorter than minMinutes", () => {
    const busy = [span(at(9), at(10)), span(at(10, 30), at(11))];
    expect(hm(freeGaps(busy, from, to, 45))).toEqual(["8:00-9:00", "11:00-12:00"]);
    expect(hm(freeGaps(busy, from, to, 60))).toEqual(["8:00-9:00", "11:00-12:00"]);
    expect(hm(freeGaps(busy, from, to, 61))).toEqual([]);
    expect(hm(freeGaps(busy, from, to, 30))).toEqual(["8:00-9:00", "10:00-10:30", "11:00-12:00"]);
    expect(hm(freeGaps(busy, from, to, 0))).toEqual(["8:00-9:00", "10:00-10:30", "11:00-12:00"]);
  });

  it("keeps a gap of exactly minMinutes", () => {
    expect(freeGaps([], at(8), at(8, 45), 45)).toEqual([{ start: at(8), end: at(8, 45), minutes: 45 }]);
    expect(freeGaps([], at(8), at(8, 44), 45)).toEqual([]);
  });

  it("rounds gap minutes down", () => {
    const gaps = freeGaps([], at(8), new Date(2026, 10, 19, 8, 1, 30), 1);
    expect(gaps[0].minutes).toBe(1);
  });

  it("accepts busy spans in any order", () => {
    const gaps = freeGaps([span(at(10), at(11)), span(at(9), at(9, 30))], from, to, 15);
    expect(hm(gaps)).toEqual(["8:00-9:00", "9:30-10:00", "11:00-12:00"]);
  });

  it("returns nothing when from is not before to", () => {
    expect(freeGaps([], to, from, 15)).toEqual([]);
    expect(freeGaps([], from, from, 0)).toEqual([]);
  });
});

const task = (over: Partial<Task> & { title: string }): Task => newTask({ all_day: false, ...over });
const ev = (over: Partial<GEvent> & { id: string }): GEvent => ({
  calendar_id: "c", summary: over.id, description: "", start: iso(at(15)), end: iso(at(16)), all_day: false, etag: "x",
  recurring_event_id: null, recurrence: null, list_id: null, starred: false, flagged: false, todo: false, reminders: [], read_only: false,
  ...over,
});

describe("tonightCapacity", () => {
  // Tonight's work: Essay 18:00 (60m), Read all-day today (default 30m), Old due yesterday 14:00 (overdue, 45m).
  // Busy: meeting 15-16, Essay block 17-18, Old block 13:15-14:00 (already past).
  // Free from 14:00 to 22:00: 14-15 (60), 16-17 (60), 18-22 (240) = 360.
  const tasks = [
    task({ title: "Essay", due_at: iso(at(18)), duration_minutes: 60 }),
    task({ title: "Read", due_at: iso(at(0)), all_day: true }),
    task({ title: "Old", due_at: iso(at(14, 0, 18)), duration_minutes: 45 }),
    task({ title: "Tomorrow", due_at: iso(at(10, 0, 20)) }),
    task({ title: "Done", due_at: iso(at(16)), completed_at: iso(at(13)) }),
    task({ title: "Undated" }),
  ];
  const events = [ev({ id: "Meet" }), ev({ id: "Holiday", all_day: true, start: "2026-11-19", end: "2026-11-20" })];

  it("sums open tasks due today or overdue, and counts them", () => {
    expect(tonightCapacity({ tasks, events, now: NOW })).toEqual({ workMinutes: 135, freeMinutes: 360, taskCount: 3 });
  });

  it("uses the default take length for tasks without one", () => {
    const c = tonightCapacity({ tasks: [task({ title: "Quick", due_at: iso(at(18)), duration_minutes: null })], events: [], now: NOW });
    expect(c.workMinutes).toBe(30);
  });

  it("leaves out tasks due on other days and completed tasks", () => {
    const c = tonightCapacity({ tasks: [tasks[3], tasks[4], tasks[5]], events: [], now: NOW });
    expect(c).toEqual({ workMinutes: 0, freeMinutes: 480, taskCount: 0 });
  });

  it("counts a timed task that is already past today as overdue work", () => {
    const c = tonightCapacity({ tasks: [task({ title: "Lunch form", due_at: iso(at(12)), duration_minutes: 20 })], events: [], now: NOW });
    expect(c).toEqual({ workMinutes: 20, freeMinutes: 480, taskCount: 1 });
  });

  it("ignores all-day events as busy time", () => {
    const c = tonightCapacity({ tasks: [], events: [ev({ id: "Holiday", all_day: true, start: "2026-11-19", end: "2026-11-20" })], now: NOW });
    expect(c.freeMinutes).toBe(480);
  });

  it("does not let a completed timed task block time", () => {
    const c = tonightCapacity({ tasks: [task({ title: "Gym", due_at: iso(at(18)), duration_minutes: 60, completed_at: iso(at(13)) })], events: [], now: NOW });
    expect(c.freeMinutes).toBe(480);
  });

  it("drops gaps shorter than minGapMinutes from free time", () => {
    const events2 = [ev({ id: "A", start: iso(at(14, 10)), end: iso(at(14, 20)) })];
    expect(tonightCapacity({ tasks: [], events: events2, now: NOW }).freeMinutes).toBe(460);
    expect(tonightCapacity({ tasks: [], events: events2, now: NOW, minGapMinutes: 5 }).freeMinutes).toBe(470);
  });

  it("measures free time from now, not from the start of the day", () => {
    const c = tonightCapacity({ tasks: [], events: [], now: at(20) });
    expect(c.freeMinutes).toBe(120);
  });

  it("has no free time once it is past the day end", () => {
    const late = at(22, 30);
    const c = tonightCapacity({ tasks: [task({ title: "Essay", due_at: iso(at(18)), duration_minutes: 60 })], events: [], now: late });
    expect(c).toEqual({ workMinutes: 60, freeMinutes: 0, taskCount: 1 });
  });

  it("respects a custom day end", () => {
    const c = tonightCapacity({ tasks, events, now: NOW, dayEndHour: 18 });
    expect(c.freeMinutes).toBe(120);
  });

  it("has no free time at the day end itself", () => {
    expect(tonightCapacity({ tasks: [], events: [], now: at(22) }).freeMinutes).toBe(0);
  });
});

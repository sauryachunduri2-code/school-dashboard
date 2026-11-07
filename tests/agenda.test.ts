import { describe, expect, it } from "vitest";
import { buildAgenda, countdowns } from "@/lib/agenda";
import { newTask } from "@/lib/tasks";
import type { GEvent } from "@/lib/types";

const NOW = new Date(2026, 10, 6, 12, 0);
const at = (d: number, h = 0) => new Date(2026, 10, d, h).toISOString();
const ev = (over: Partial<GEvent>): GEvent => ({
  id: "e", calendar_id: "c", summary: "Meet", description: "", start: at(7, 15), end: at(7, 16), all_day: false, etag: "x",
  recurring_event_id: null, recurrence: null, list_id: null, starred: false, flagged: false, todo: false, reminders: [], read_only: false, ...over,
});

describe("agenda", () => {
  it("splits overdue, per-day items and undated tasks", () => {
    const tasks = [
      newTask({ id: "od", title: "late", due_at: at(4), all_day: true }),
      newTask({ id: "t1", title: "today", due_at: at(6), all_day: true }),
      newTask({ id: "t2", title: "tmrw 9am", due_at: at(7, 9) }),
      newTask({ id: "u", title: "someday" }),
      newTask({ id: "done", title: "done", due_at: at(6), all_day: true, completed_at: at(6, 1) }),
      newTask({ id: "far", title: "far", due_at: at(30), all_day: true }),
    ];
    const a = buildAgenda(tasks, [ev({})], NOW);
    expect(a.overdue.map((i) => i.title)).toEqual(["late"]);
    expect(a.days[0].items.map((i) => i.title)).toEqual(["today"]);
    expect(a.days[1].items.map((i) => i.title)).toEqual(["tmrw 9am", "Meet"]);
    expect(a.undated.map((i) => i.title)).toEqual(["someday"]);
    expect(a.days).toHaveLength(7);
  });
  it("shows a multi-day all-day event on each day it covers", () => {
    const a = buildAgenda([], [ev({ all_day: true, start: "2026-11-06", end: "2026-11-09" })], NOW);
    expect(a.days.map((d) => d.items.length).slice(0, 4)).toEqual([1, 1, 1, 0]);
  });
  it("countdowns: starred and in the future, one per recurring series, soonest first", () => {
    const tasks = [newTask({ title: "AP exam", starred: true, due_at: at(20), all_day: true }), newTask({ title: "plain", due_at: at(8) })];
    const events = [
      ev({ id: "i1", summary: "Club", starred: true, recurring_event_id: "m", start: at(9, 15), end: at(9, 16) }),
      ev({ id: "i2", summary: "Club", starred: true, recurring_event_id: "m", start: at(16, 15), end: at(16, 16) }),
    ];
    expect(countdowns(tasks, events, NOW).map((i) => i.title)).toEqual(["Club", "AP exam"]);
  });
});

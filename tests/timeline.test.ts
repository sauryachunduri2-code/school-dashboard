import { describe, expect, it } from "vitest";
import { buildDayTimeline, dayWindowStart, formatTakes, homeTimedItems, takesMinutes, untimedByDay } from "@/lib/timeline";
import { completeTask, newTask } from "@/lib/tasks";
import type { GEvent } from "@/lib/types";

// Nov 2026: the 7th is a Saturday.
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const day = (d: number) => new Date(2026, 10, d);
const mkEvent = (id: string, s: Date, e: Date, over: Partial<GEvent> = {}): GEvent => ({
  id, calendar_id: "c", summary: id, description: "", start: s.toISOString(), end: e.toISOString(), all_day: false, etag: "x",
  recurring_event_id: null, recurrence: null, list_id: null, starred: false, flagged: false, todo: false, reminders: [], read_only: false, ...over,
});
const allDayEvent = (id: string, startYmd: string, endYmd: string) => mkEvent(id, new Date(), new Date(), { all_day: true, start: startYmd, end: endYmd });
const timeline = (d: number, tasks: ReturnType<typeof newTask>[], events: GEvent[]) => buildDayTimeline(day(d), homeTimedItems(tasks, events, [], []));
const row = (p: { top: number; height: number }) => [p.top, p.top + p.height];

describe("day window", () => {
  it("defaults to 4 AM", () => {
    expect(dayWindowStart([])).toBe(240);
    expect(timeline(7, [], []).startMin).toBe(240);
  });
  it("starts at the hour at or before the earliest 12-4 AM item", () => {
    expect(dayWindowStart([90, 200])).toBe(60);
    expect(dayWindowStart([0])).toBe(0);
    expect(dayWindowStart([180])).toBe(180);
  });
  it("extends only the day that has the early item", () => {
    const early = newTask({ title: "late night", due_at: at(8, 1, 40).toISOString() });
    expect(timeline(8, [early], []).startMin).toBe(60); // block 1:10-1:40, so the window opens at 1 AM
    expect(timeline(7, [early], []).startMin).toBe(240);
    expect(timeline(9, [early], []).startMin).toBe(240);
  });
  it("ignores tasks due after 4 AM for the window", () => {
    const t = newTask({ title: "x", due_at: at(7, 4, 20).toISOString(), duration_minutes: 60 });
    expect(timeline(7, [t], []).startMin).toBe(240);
  });
  it("an event starting after midnight extends that day", () => {
    expect(timeline(7, [], [mkEvent("e", at(7, 2, 15), at(7, 3, 0))]).startMin).toBe(120);
  });
});

describe("task blocks", () => {
  it("ends at the due time and is `takes` tall", () => {
    const t = newTask({ title: "t", due_at: at(7, 15, 0).toISOString(), duration_minutes: 90 });
    const [p] = timeline(7, [t], []).placed;
    expect(row(p)).toEqual([13 * 60 + 30, 15 * 60]);
  });
  it("is 30 minutes when takes is unset", () => {
    expect(takesMinutes({})).toBe(30);
    expect(takesMinutes({ duration_minutes: null })).toBe(30);
    const t = newTask({ title: "t", due_at: at(7, 9, 0).toISOString() });
    expect(row(timeline(7, [t], []).placed[0])).toEqual([8 * 60 + 30, 9 * 60]);
  });
  it("clips a start that falls before the window", () => {
    const t = newTask({ title: "t", due_at: at(7, 4, 30).toISOString(), duration_minutes: 120 });
    expect(row(timeline(7, [t], []).placed[0])).toEqual([240, 270]);
  });
  it("shows a long task fully when the window was extended", () => {
    const t = newTask({ title: "t", due_at: at(7, 2, 0).toISOString(), duration_minutes: 90 });
    const tl = timeline(7, [t], []);
    expect(tl.startMin).toBe(0);
    expect(row(tl.placed[0])).toEqual([30, 120]);
  });
  it("only appears on its due day and keeps completed tasks (faded)", () => {
    const done = newTask({ title: "d", due_at: at(7, 10, 0).toISOString(), completed_at: at(7, 9).toISOString() });
    expect(timeline(7, [done], []).placed.map((p) => p.item.done)).toEqual([true]);
    expect(timeline(8, [done], []).placed).toHaveLength(0);
  });
  it("leaves date-only tasks out of the timeline", () => {
    const t = newTask({ title: "t", due_at: at(7, 0).toISOString(), all_day: true });
    expect(timeline(7, [t], []).placed).toHaveLength(0);
  });
  it("puts overlapping blocks side by side", () => {
    const a = newTask({ title: "a", due_at: at(7, 10, 0).toISOString(), duration_minutes: 60 });
    const e = mkEvent("e", at(7, 9, 30), at(7, 10, 30));
    expect(timeline(7, [a], [e]).placed.map((p) => [p.col, p.cols])).toEqual([[0, 2], [1, 2]]);
  });
});

describe("events across midnight", () => {
  const night = mkEvent("night", at(7, 22, 0), at(8, 1, 0));
  it("shows its part on each day", () => {
    const d7 = timeline(7, [], [night]);
    const d8 = timeline(8, [], [night]);
    expect(row(d7.placed[0])).toEqual([22 * 60, 24 * 60]);
    expect(row(d8.placed[0])).toEqual([0, 60]);
    expect(timeline(9, [], [night]).placed).toHaveLength(0);
  });
  it("extends the second day's window to midnight, not the first", () => {
    expect(timeline(7, [], [night]).startMin).toBe(240);
    expect(timeline(8, [], [night]).startMin).toBe(0);
  });
  it("clips an event that starts before the window", () => {
    const e = mkEvent("e", at(7, 3, 0), at(7, 5, 0));
    const tl = timeline(7, [], [e]);
    expect(tl.startMin).toBe(180);
    expect(row(tl.placed[0])).toEqual([180, 300]);
  });
  it("skips all-day events", () => {
    expect(timeline(7, [], [allDayEvent("a", "2026-11-07", "2026-11-08")]).placed).toHaveLength(0);
  });
});

describe("untimed grouping", () => {
  const now = at(7, 14, 0);
  const titles = (days: ReturnType<typeof untimedByDay>, i: number) => days[i].map((e) => e.item.title);
  it("puts date-only tasks and all-day events on their days", () => {
    const tasks = [
      newTask({ title: "today", due_at: at(7, 0).toISOString(), all_day: true }),
      newTask({ title: "mon", due_at: at(9, 0).toISOString(), all_day: true }),
      newTask({ title: "far", due_at: at(20, 0).toISOString(), all_day: true }),
    ];
    const days = untimedByDay(tasks, [allDayEvent("trip", "2026-11-08", "2026-11-10")], now);
    expect(titles(days, 0)).toEqual(["today"]);
    expect(titles(days, 1)).toEqual(["trip"]);
    expect(titles(days, 2)).toEqual(["trip", "mon"]);
    expect(days.flat().some((e) => e.item.title === "far")).toBe(false);
  });
  it("moves overdue tasks (open, due before today) to Today, first", () => {
    const tasks = [
      newTask({ title: "old date-only", due_at: at(3, 0).toISOString(), all_day: true }),
      newTask({ title: "old timed", due_at: at(5, 16, 0).toISOString() }),
      newTask({ title: "old done", due_at: at(4, 0).toISOString(), all_day: true, completed_at: at(4, 5).toISOString() }),
      newTask({ title: "today date-only", due_at: at(7, 0).toISOString(), all_day: true }),
    ];
    const days = untimedByDay(tasks, [allDayEvent("conf", "2026-11-07", "2026-11-08")], now);
    expect(titles(days, 0)).toEqual(["old date-only", "old timed", "conf", "today date-only"]);
    expect(days[0].map((e) => e.overdue)).toEqual([true, true, false, false]);
  });
  it("keeps a timed task that is only late earlier today in the timeline", () => {
    const t = newTask({ title: "morning", due_at: at(7, 9, 0).toISOString() });
    expect(untimedByDay([t], [], now)[0]).toHaveLength(0);
    expect(timeline(7, [t], []).placed).toHaveLength(1);
  });
  it("sorts completed tasks last and ignores timed and undated tasks", () => {
    const tasks = [
      newTask({ title: "done", due_at: at(8, 0).toISOString(), all_day: true, completed_at: at(7, 1).toISOString() }),
      newTask({ title: "open", due_at: at(8, 0).toISOString(), all_day: true }),
      newTask({ title: "timed", due_at: at(8, 9).toISOString() }),
      newTask({ title: "undated" }),
    ];
    expect(titles(untimedByDay(tasks, [], now), 1)).toEqual(["open", "done"]);
  });
});

describe("takes helpers", () => {
  it("formats minutes", () => {
    expect([15, 45, 60, 90, 120].map(formatTakes)).toEqual(["15m", "45m", "1h", "1h 30m", "2h"]);
  });
  it("carries the duration to the next occurrence of a repeating task", () => {
    const t = newTask({ title: "r", due_at: at(7, 10).toISOString(), rrule: "FREQ=DAILY", duration_minutes: 45 });
    expect(completeTask(t, at(7, 11)).next?.duration_minutes).toBe(45);
  });
  it("leaves the field off when unset", () => {
    const t = newTask({ title: "r", due_at: at(7, 10).toISOString(), rrule: "FREQ=DAILY" });
    expect("duration_minutes" in completeTask(t, at(7, 11)).next!).toBe(false);
  });
});

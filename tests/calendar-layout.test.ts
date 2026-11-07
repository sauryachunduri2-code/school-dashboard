import { describe, expect, it } from "vitest";
import { eventPatchFor, moveItem, placeTimed, snap, toCalItems, type CalItem } from "@/components/calendar/layout";
import { newTask } from "@/lib/tasks";
import type { GEvent } from "@/lib/types";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const mkEvent = (id: string, s: Date, e: Date, over: Partial<GEvent> = {}): GEvent => ({
  id, calendar_id: "c", summary: id, description: "", start: s.toISOString(), end: e.toISOString(), all_day: false, etag: "x",
  recurring_event_id: null, recurrence: null, list_id: null, starred: false, flagged: false, todo: false, reminders: [], read_only: false, ...over,
});
const items = (events: GEvent[]) => toCalItems([], events, [], []);

describe("calendar layout", () => {
  it("places non-overlapping items in a single column", () => {
    const p = placeTimed(items([mkEvent("a", at(9, 9), at(9, 10)), mkEvent("b", at(9, 11), at(9, 12))]), at(9, 0));
    expect(p.map((x) => [x.col, x.cols])).toEqual([[0, 1], [0, 1]]);
  });
  it("puts overlapping items side by side", () => {
    const p = placeTimed(items([mkEvent("a", at(9, 9), at(9, 11)), mkEvent("b", at(9, 10), at(9, 12)), mkEvent("c", at(9, 13), at(9, 14))]), at(9, 0));
    expect(p.map((x) => [x.item.title, x.col, x.cols])).toEqual([["a", 0, 2], ["b", 1, 2], ["c", 0, 1]]);
  });
  it("gives timed tasks a 30 minute block and skips completed ones", () => {
    const t = newTask({ title: "t", due_at: at(9, 9).toISOString() });
    const done = newTask({ title: "d", due_at: at(9, 9).toISOString(), completed_at: at(9, 8).toISOString() });
    const list = toCalItems([t, done], [], [], []);
    expect(list).toHaveLength(1);
    expect(placeTimed(list, at(9, 0))[0].height).toBe(30);
  });
  it("moves timed items by days and snapped minutes", () => {
    const [i] = items([mkEvent("a", at(9, 15), at(9, 16))]);
    const r = moveItem(i, 1, snap(37));
    expect(r.start).toEqual(at(10, 15, 30));
    expect(r.end).toEqual(at(10, 16, 30));
  });
  it("moves all-day items by whole days and builds a Google date patch", () => {
    const ev = mkEvent("a", new Date(2026, 10, 9), new Date(2026, 10, 10), { all_day: true, start: "2026-11-09", end: "2026-11-10" });
    const [i] = items([ev]) as CalItem[];
    const r = moveItem(i, 2, 120);
    expect(eventPatchFor(i, r)).toEqual({ start: "2026-11-11", end: "2026-11-12", all_day: true });
  });
  it("keeps wall-clock time across a DST change", () => {
    const [i] = items([mkEvent("a", at(1, 0, 30), at(1, 1, 30))]); // Nov 1 2026 is fall-back day
    const r = moveItem(i, 1, 0);
    expect(r.start).toEqual(at(2, 0, 30));
  });
});

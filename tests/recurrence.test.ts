import { describe, expect, it } from "vitest";
import { buildRrule, describeRrule, nextOccurrence, parseRepeat } from "@/lib/recurrence";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe("recurrence", () => {
  it("daily next occurrence", () => {
    expect(nextOccurrence("RRULE:FREQ=DAILY", at(2026, 11, 6, 9))).toEqual(at(2026, 11, 7, 9));
  });
  it("weekly on days picks the next listed day", () => {
    // Fri Nov 6 -> next Mon Nov 9
    expect(nextOccurrence("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR", at(2026, 11, 6, 16))).toEqual(at(2026, 11, 9, 16));
    expect(nextOccurrence("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR", at(2026, 11, 9, 16))).toEqual(at(2026, 11, 11, 16));
  });
  it("weekly with no BYDAY repeats on the same weekday", () => {
    expect(nextOccurrence("RRULE:FREQ=WEEKLY", at(2026, 11, 6, 8))).toEqual(at(2026, 11, 13, 8));
  });
  it("monthly keeps day of month", () => {
    expect(nextOccurrence("RRULE:FREQ=MONTHLY", at(2026, 11, 15, 8))).toEqual(at(2026, 12, 15, 8));
  });
  it("stays at the same wall-clock time across DST (US fall back Nov 1 2026)", () => {
    expect(nextOccurrence("RRULE:FREQ=DAILY", at(2026, 10, 31, 16))).toEqual(at(2026, 11, 1, 16));
  });
  it("returns null after UNTIL", () => {
    const rule = buildRrule({ freq: "daily", until: at(2026, 11, 7) });
    expect(nextOccurrence(rule, at(2026, 11, 7, 9))).toBeNull();
    expect(nextOccurrence(rule, at(2026, 11, 6, 9))).toEqual(at(2026, 11, 7, 9));
  });
  it("round-trips build/parse", () => {
    const rule = buildRrule({ freq: "weekly", days: [5, 1, 3] });
    expect(rule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(parseRepeat(rule)).toEqual({ freq: "weekly", days: [1, 3, 5], until: null });
  });
  it("describes rules", () => {
    expect(describeRrule(null)).toBe("Does not repeat");
    expect(describeRrule("RRULE:FREQ=DAILY")).toBe("Every day");
    expect(describeRrule("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("Every weekday");
    expect(describeRrule("RRULE:FREQ=WEEKLY;BYDAY=TU,TH")).toBe("Every Tue, Thu");
  });
});

import { completeTask, isOverdue, newTask } from "@/lib/tasks";

describe("completing repeating tasks", () => {
  it("non-repeating tasks just complete", () => {
    const { completed, next } = completeTask(newTask({ title: "a" }), at(2026, 11, 6, 12));
    expect(completed.completed_at).not.toBeNull();
    expect(next).toBeNull();
  });
  it("repeating tasks spawn the next occurrence", () => {
    const due = at(2026, 11, 9, 16);
    const t = newTask({
      title: "club",
      due_at: due.toISOString(),
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
      starred: true,
    });
    const { completed, next } = completeTask(t, at(2026, 11, 9, 10));
    expect(completed.completed_at).not.toBeNull();
    expect(next!.id).not.toBe(t.id);
    expect(new Date(next!.due_at!)).toEqual(at(2026, 11, 16, 16));
    expect(next!.starred).toBe(true);
    expect(next!.completed_at).toBeNull();
  });
  it("the next occurrence keeps the default switch and relative reminders but drops exact times", () => {
    const due = at(2026, 11, 9, 16);
    const t = newTask({
      title: "club",
      due_at: due.toISOString(),
      remind_default: false,
      reminders: [
        { kind: "offset", minutes: 60 },
        { kind: "at", at: at(2026, 11, 8, 19).toISOString() },
        { kind: "offset", minutes: 1440 },
      ],
      rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
    });
    const { completed, next } = completeTask(t, at(2026, 11, 9, 10));
    expect(completed.reminders).toHaveLength(3);
    expect(next!.remind_default).toBe(false);
    expect(next!.reminders).toEqual([
      { kind: "offset", minutes: 60 },
      { kind: "offset", minutes: 1440 },
    ]);
  });
  it("a new task has the default reminder on and no custom ones", () => {
    const t = newTask({ title: "a" });
    expect(t.remind_default).toBe(true);
    expect(t.reminders).toEqual([]);
  });
  it("a late completion skips occurrences already in the past", () => {
    const t = newTask({ title: "daily", due_at: at(2026, 11, 1, 9).toISOString(), rrule: "RRULE:FREQ=DAILY" });
    const { next } = completeTask(t, at(2026, 11, 6, 12));
    expect(new Date(next!.due_at!)).toEqual(at(2026, 11, 7, 9));
  });
  it("overdue: all-day due yesterday is overdue, due today is not", () => {
    const now = at(2026, 11, 6, 12);
    expect(isOverdue(newTask({ title: "a", all_day: true, due_at: at(2026, 11, 5).toISOString() }), now)).toBe(true);
    expect(isOverdue(newTask({ title: "a", all_day: true, due_at: at(2026, 11, 6).toISOString() }), now)).toBe(false);
    expect(isOverdue(newTask({ title: "a", due_at: at(2026, 11, 6, 9).toISOString() }), now)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  candidateWindow,
  carryReminders,
  computeRemindAt,
  DEFAULT_REMINDER_SETTINGS,
  MAX_AGE_MS,
  normalizeTask,
  offsetLabel,
  reminderBase,
  sanitizeReminders,
  sanitizeSettings,
  selectDueReminders,
  taskFireTimes,
  type ReminderSettings,
} from "@/lib/reminders";
import type { Task } from "@/lib/types";

const NOW = new Date("2026-11-06T17:00:00Z");
const iso = (d: Date) => d.toISOString();
const mk = (over: Partial<Task>): Task => ({
  id: "t",
  title: "x",
  notes: "",
  list_id: null,
  due_at: null,
  all_day: false,
  remind_default: true,
  reminders: [],
  rrule: null,
  starred: false,
  flagged: false,
  completed_at: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  ...over,
});
const S = (over: Partial<ReminderSettings> = {}): ReminderSettings => ({ ...DEFAULT_REMINDER_SETTINGS, ...over });
const fires = (t: Task, s = S()) => taskFireTimes(t, s).map((f) => iso(f.at));

describe("default reminder computation", () => {
  it("computes remind time from due minus offset", () => {
    expect(computeRemindAt(new Date("2026-11-06T20:00:00Z"), 90).toISOString()).toBe("2026-11-06T18:30:00.000Z");
  });
  it("defaults to at the due time", () => {
    expect(fires(mk({ due_at: "2026-11-06T20:00:00Z" }))).toEqual(["2026-11-06T20:00:00.000Z"]);
  });
  it.each([
    [0, "20:00"],
    [5, "19:55"],
    [15, "19:45"],
    [30, "19:30"],
    [60, "19:00"],
  ])("offset %i min before a timed task", (offset, hhmm) => {
    expect(fires(mk({ due_at: "2026-11-06T20:00:00Z" }), S({ default_remind_offset: offset }))).toEqual([`2026-11-06T${hhmm}:00.000Z`]);
  });
  it("1 day before", () => {
    expect(fires(mk({ due_at: "2026-11-06T20:00:00Z" }), S({ default_remind_offset: 1440 }))).toEqual(["2026-11-05T20:00:00.000Z"]);
  });
  it("no default reminder when the setting is none", () => {
    expect(fires(mk({ due_at: "2026-11-06T20:00:00Z" }), S({ default_remind_offset: null }))).toEqual([]);
  });
  it("no default reminder without a due date", () => {
    expect(fires(mk({}))).toEqual([]);
  });
  it("a task can turn its default reminder off", () => {
    expect(fires(mk({ due_at: "2026-11-06T20:00:00Z", remind_default: false }))).toEqual([]);
  });
  it("all-day tasks use the configured time on the due day (default 8:00 AM)", () => {
    const due = new Date(2026, 10, 20); // local midnight
    expect(reminderBase(due, true, S())).toEqual(new Date(2026, 10, 20, 8, 0));
    expect(fires(mk({ due_at: iso(due), all_day: true }))).toEqual([iso(new Date(2026, 10, 20, 8, 0))]);
  });
  it("all-day time is configurable, and offsets count back from it", () => {
    const due = new Date(2026, 10, 20);
    expect(fires(mk({ due_at: iso(due), all_day: true }), S({ allday_remind_minutes: 9 * 60 + 30 }))).toEqual([iso(new Date(2026, 10, 20, 9, 30))]);
    expect(fires(mk({ due_at: iso(due), all_day: true }), S({ default_remind_offset: 1440 }))).toEqual([iso(new Date(2026, 10, 19, 8, 0))]);
    expect(fires(mk({ due_at: iso(due), all_day: true }), S({ default_remind_offset: 60 }))).toEqual([iso(new Date(2026, 10, 20, 7, 0))]);
  });
});

describe("custom reminders", () => {
  const due = "2026-11-06T20:00:00Z";
  it("adds several custom reminders on top of the default, sorted", () => {
    const t = mk({
      due_at: due,
      reminders: [
        { kind: "offset", minutes: 1440 },
        { kind: "at", at: "2026-11-06T18:00:00Z" },
        { kind: "offset", minutes: 60 },
      ],
    });
    expect(fires(t)).toEqual(["2026-11-05T20:00:00.000Z", "2026-11-06T18:00:00.000Z", "2026-11-06T19:00:00.000Z", "2026-11-06T20:00:00.000Z"]);
  });
  it("labels the default vs custom source", () => {
    const t = mk({ due_at: due, reminders: [{ kind: "offset", minutes: 60 }] });
    expect(taskFireTimes(t, S()).map((f) => f.source)).toEqual(["custom", "default"]);
  });
  it("works with the default turned off", () => {
    expect(fires(mk({ due_at: due, remind_default: false, reminders: [{ kind: "offset", minutes: 30 }] }))).toEqual(["2026-11-06T19:30:00.000Z"]);
  });
  it("exact-time reminders work without a due date; relative ones are ignored", () => {
    const t = mk({ reminders: [{ kind: "at", at: "2026-11-07T00:00:00Z" }, { kind: "offset", minutes: 10 }] });
    expect(fires(t)).toEqual(["2026-11-07T00:00:00.000Z"]);
  });
  it("a custom reminder on the same instant as the default is one reminder", () => {
    expect(fires(mk({ due_at: due, reminders: [{ kind: "offset", minutes: 0 }, { kind: "at", at: due }] }))).toEqual(["2026-11-06T20:00:00.000Z"]);
  });
  it("relative custom reminders on all-day tasks count from the all-day time", () => {
    const d = new Date(2026, 10, 20);
    expect(fires(mk({ due_at: iso(d), all_day: true, remind_default: false, reminders: [{ kind: "offset", minutes: 120 }] }))).toEqual([iso(new Date(2026, 10, 20, 6, 0))]);
  });
  it("sanitizes junk, duplicates, and out-of-range values", () => {
    expect(
      sanitizeReminders([
        { kind: "offset", minutes: 60 },
        { kind: "offset", minutes: 60 },
        { kind: "offset", minutes: -5 },
        { kind: "offset", minutes: 1.5 },
        { kind: "at", at: "nope" },
        { kind: "at", at: "2026-11-07T00:00:00Z" },
        null,
        "x",
      ]),
    ).toEqual([
      { kind: "offset", minutes: 60 },
      { kind: "at", at: "2026-11-07T00:00:00.000Z" },
    ]);
    expect(sanitizeReminders(undefined)).toEqual([]);
  });
  it("sanitizes settings, keeping null as 'none'", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(sanitizeSettings({ default_remind_offset: null, allday_remind_minutes: 600 })).toEqual({ default_remind_offset: null, allday_remind_minutes: 600 });
    expect(sanitizeSettings({ default_remind_offset: -3, allday_remind_minutes: 5000 })).toEqual(DEFAULT_REMINDER_SETTINGS);
  });
  it("labels offsets", () => {
    expect([0, 5, 60, 120, 1440, 2880, 10080, 90].map(offsetLabel)).toEqual([
      "At due time",
      "5 min before",
      "1 hour before",
      "2 hours before",
      "1 day before",
      "2 days before",
      "1 week before",
      "90 min before",
    ]);
  });
});

describe("repeat carry-over", () => {
  it("keeps relative reminders and the default switch, drops exact times", () => {
    expect(
      carryReminders({ remind_default: false, reminders: [{ kind: "offset", minutes: 30 }, { kind: "at", at: "2026-11-07T00:00:00Z" }] }),
    ).toEqual({ remind_default: false, reminders: [{ kind: "offset", minutes: 30 }] });
  });
});

describe("due selection (per task + fire time)", () => {
  it("selects reminders whose time has passed", () => {
    const t = mk({ id: "a", due_at: "2026-11-06T16:59:00Z" });
    const due = selectDueReminders([t], [], NOW);
    expect(due.map((d) => d.task.id)).toEqual(["a"]);
    expect(due[0].fireAts.map(iso)).toEqual(["2026-11-06T16:59:00.000Z"]);
  });
  it("skips future reminders, and tasks with no reminder", () => {
    const tasks = [mk({ id: "a", due_at: "2026-11-06T17:01:00Z" }), mk({ id: "b" })];
    expect(selectDueReminders(tasks, [], NOW)).toEqual([]);
  });
  it("skips completed tasks", () => {
    expect(selectDueReminders([mk({ due_at: "2026-11-06T16:00:00Z", completed_at: "2026-11-06T16:30:00Z" })], [], NOW)).toEqual([]);
  });
  it("skips stale reminders", () => {
    const t = mk({ due_at: iso(new Date(+NOW - MAX_AGE_MS - 1000)) });
    expect(selectDueReminders([t], [], NOW)).toEqual([]);
  });
  it("skips a fire time that was already in the past when the task was saved", () => {
    const t = mk({ due_at: "2026-11-06T15:00:00Z", updated_at: "2026-11-06T16:30:00Z" });
    expect(selectDueReminders([t], [], NOW)).toEqual([]);
    // but a few minutes of clock skew / "due right now" still fires
    const fresh = mk({ due_at: "2026-11-06T16:58:00Z", updated_at: "2026-11-06T17:00:00Z" });
    expect(selectDueReminders([fresh], [], NOW)).toHaveLength(1);
  });
  it("dedupes per (task, fire time): a sent default doesn't block a later custom one", () => {
    const t = mk({ id: "a", due_at: "2026-11-06T16:30:00Z", reminders: [{ kind: "offset", minutes: 30 }, { kind: "at", at: "2026-11-06T16:50:00Z" }] });
    const sends = [{ task_id: "a", remind_at: "2026-11-06T16:30:00+00:00" }];
    const due = selectDueReminders([t], sends, NOW);
    expect(due).toHaveLength(1);
    expect(due[0].fireAts.map(iso)).toEqual(["2026-11-06T16:00:00.000Z", "2026-11-06T16:50:00.000Z"]);
  });
  it("same fire time on a different task is independent", () => {
    const a = mk({ id: "a", due_at: "2026-11-06T16:30:00Z" });
    const b = mk({ id: "b", due_at: "2026-11-06T16:30:00Z" });
    const due = selectDueReminders([a, b], [{ task_id: "a", remind_at: "2026-11-06T16:30:00Z" }], NOW);
    expect(due.map((d) => d.task.id)).toEqual(["b"]);
  });
  it("editing the due time: an already-sent fire time is not re-sent, a new one is", () => {
    const sends = [{ task_id: "a", remind_at: "2026-11-06T16:00:00Z" }];
    // due moved later, but a 60-min custom reminder still lands on the sent 16:00 instant
    const sameFire = mk({ id: "a", due_at: "2026-11-06T17:00:00Z", remind_default: false, reminders: [{ kind: "offset", minutes: 60 }], updated_at: "2026-11-06T15:00:00Z" });
    expect(selectDueReminders([sameFire], sends, NOW)).toEqual([]);
    // due moved so the fire time changes: the new instant is sent
    const moved = mk({ id: "a", due_at: "2026-11-06T16:45:00Z", remind_default: false, reminders: [{ kind: "offset", minutes: 60 }], updated_at: "2026-11-06T15:00:00Z" });
    expect(selectDueReminders([moved], sends, NOW).map((d) => d.fireAts.map(iso))).toEqual([["2026-11-06T15:45:00.000Z"]]);
  });
  it("editing the default offset in Settings recalculates without re-sending", () => {
    const t = mk({ id: "a", due_at: "2026-11-06T17:30:00Z", updated_at: "2026-11-06T10:00:00Z" });
    const sends = [{ task_id: "a", remind_at: "2026-11-06T17:00:00Z" }];
    expect(selectDueReminders([t], sends, NOW, S({ default_remind_offset: 30 }))).toEqual([]);
    expect(selectDueReminders([t], [], NOW, S({ default_remind_offset: 30 }))).toHaveLength(1);
  });
  it("uses the all-day time for all-day tasks", () => {
    const d = new Date(2026, 10, 6); // local midnight
    const t = mk({ due_at: iso(d), all_day: true, updated_at: "2026-11-01T00:00:00Z" });
    const at8 = new Date(2026, 10, 6, 8, 1);
    expect(selectDueReminders([t], [], new Date(2026, 10, 6, 7, 59))).toEqual([]);
    expect(selectDueReminders([t], [], at8)).toHaveLength(1);
  });
  it("candidate window covers the offset and all-day ranges", () => {
    const w = candidateWindow(NOW);
    expect(+w.dueFrom).toBeLessThan(+NOW - MAX_AGE_MS - 23 * 3600_000);
    expect(+w.dueTo).toBeGreaterThanOrEqual(+NOW + 30 * 86400_000);
  });
});

describe("legacy rows", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const legacy = (over: Record<string, unknown>) => ({ ...mk({ due_at: "2026-11-20T20:00:00Z" }), reminders: undefined, remind_default: undefined, ...over }) as unknown as Task;
  it("timed task with an offset becomes a custom offset and drops the default", () => {
    const t = normalizeTask(legacy({ remind_at: "2026-11-20T19:00:00Z", remind_offset: 60 }), now);
    expect(t).toMatchObject({ remind_default: false, reminders: [{ kind: "offset", minutes: 60 }] });
    expect("remind_at" in t).toBe(false);
  });
  it("all-day task or absolute reminder keeps its exact old time", () => {
    expect(normalizeTask(legacy({ all_day: true, remind_at: "2026-11-20T14:00:00Z", remind_offset: 0 }), now).reminders).toEqual([{ kind: "at", at: "2026-11-20T14:00:00.000Z" }]);
    expect(normalizeTask(legacy({ remind_at: "2026-11-19T01:00:00Z", remind_offset: null }), now).reminders).toEqual([{ kind: "at", at: "2026-11-19T01:00:00.000Z" }]);
  });
  it("tasks without a reminder get the default, unless already overdue or done", () => {
    expect(normalizeTask(legacy({}), now).remind_default).toBe(true);
    expect(normalizeTask(legacy({ due_at: "2026-11-01T00:00:00Z" }), now).remind_default).toBe(false);
    expect(normalizeTask(legacy({ completed_at: "2026-11-02T00:00:00Z" }), now).remind_default).toBe(false);
  });
  it("rows in the new shape are returned as-is", () => {
    const t = mk({ reminders: [{ kind: "offset", minutes: 5 }] });
    expect(normalizeTask(t, now)).toBe(t);
  });
});

import { runReminders, type ReminderDeps } from "@/lib/cron";

describe("reminder run (cron handler logic)", () => {
  const sub = { endpoint: "https://push/e1", p256dh: "k", auth: "a" };
  type Recorded = { id: string; fireAts: string[] };
  function deps(over: Partial<ReminderDeps> & { tasks: Task[] }): ReminderDeps & { recorded: Recorded[]; deleted: string[] } {
    const recorded: Recorded[] = [];
    const deleted: string[] = [];
    return {
      now: NOW,
      loadSettings: async () => DEFAULT_REMINDER_SETTINGS,
      loadCandidates: async () => over.tasks,
      loadSends: async () => [],
      loadLists: async () => [{ id: "l1", area: "ecs", name: "HOSA", color: "#000", sort: 0 }],
      loadSubscriptions: async () => [sub],
      send: async () => ({ delivered: 1, gone: [], failed: 0 }),
      recordSend: async (t, fireAts) => void recorded.push({ id: t.id, fireAts: fireAts.map(iso) }),
      deleteSubscriptions: async (e) => void deleted.push(...e),
      ...over,
      recorded,
      deleted,
    };
  }
  const due = "2026-11-06T16:59:00Z";
  it("sends due reminders and records the fire time", async () => {
    const d = deps({ tasks: [mk({ id: "a", list_id: "l1", due_at: due })] });
    const payloads: unknown[] = [];
    d.send = async (_s, p) => (payloads.push(p), { delivered: 1, gone: [], failed: 0 });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 1 });
    expect(d.recorded).toEqual([{ id: "a", fireAts: ["2026-11-06T16:59:00.000Z"] }]);
    expect(payloads[0]).toMatchObject({ title: "x", listName: "HOSA", tag: "a" });
  });
  it("uses the loaded settings (default offset)", async () => {
    const d = deps({ tasks: [mk({ id: "a", due_at: "2026-11-06T17:30:00Z", updated_at: "2026-11-06T10:00:00Z" })], loadSettings: async () => S({ default_remind_offset: 30 }) });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 1 });
    expect(d.recorded[0].fireAts).toEqual(["2026-11-06T17:00:00.000Z"]);
  });
  it("sends one push per task but records every due fire time", async () => {
    let pushes = 0;
    const t = mk({ id: "a", due_at: due, reminders: [{ kind: "offset", minutes: 30 }] });
    const d = deps({ tasks: [t], send: async () => (pushes++, { delivered: 1, gone: [], failed: 0 }) });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 1 });
    expect(pushes).toBe(1);
    expect(d.recorded[0].fireAts).toEqual(["2026-11-06T16:29:00.000Z", "2026-11-06T16:59:00.000Z"]);
  });
  it("a second run does not resend what was recorded", async () => {
    const t = mk({ id: "a", due_at: due });
    const first = deps({ tasks: [t] });
    await runReminders(first);
    const sends = first.recorded.flatMap((r) => r.fireAts.map((f) => ({ task_id: r.id, remind_at: f })));
    const second = deps({ tasks: [t], loadSends: async () => sends });
    expect(await runReminders(second)).toEqual({ due: 0, sent: 0 });
  });
  it("does not record when no push was delivered (retries next minute)", async () => {
    const d = deps({ tasks: [mk({ id: "a", due_at: due })], send: async () => ({ delivered: 0, gone: [], failed: 1 }) });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 0 });
    expect(d.recorded).toEqual([]);
  });
  it("leaves reminders unsent when no device is subscribed", async () => {
    const d = deps({ tasks: [mk({ id: "a", due_at: due })], loadSubscriptions: async () => [] });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 0 });
  });
  it("does not resend to a dead endpoint later in the same run", async () => {
    const seen: string[][] = [];
    const subs = [
      { endpoint: "https://push/dead", p256dh: "k", auth: "a" },
      { endpoint: "https://push/live", p256dh: "k", auth: "a" },
    ];
    const d = deps({
      tasks: [mk({ id: "a", due_at: due }), mk({ id: "b", due_at: due })],
      loadSubscriptions: async () => subs,
      send: async (s) => {
        seen.push(s.map((x) => x.endpoint));
        return { delivered: 1, gone: s.some((x) => x.endpoint === "https://push/dead") ? ["https://push/dead"] : [], failed: 0 };
      },
    });
    await runReminders(d);
    expect(seen).toEqual([["https://push/dead", "https://push/live"], ["https://push/live"]]);
    expect(d.deleted).toEqual(["https://push/dead"]);
  });
  it("prunes dead subscriptions", async () => {
    const d = deps({ tasks: [mk({ id: "a", due_at: due })], send: async () => ({ delivered: 1, gone: ["https://push/dead"], failed: 0 }) });
    await runReminders(d);
    expect(d.deleted).toEqual(["https://push/dead"]);
  });
});

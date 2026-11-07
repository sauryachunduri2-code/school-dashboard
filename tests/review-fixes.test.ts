import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { exclusiveEndYmd, inclusiveLastDay } from "@/lib/agenda";
import { safeNextPath } from "@/lib/auth";
import { ymd } from "@/lib/dates";
import { alertChoiceOf, alertPatch, fromGoogle, toGoogleBody } from "@/lib/google/mapping";
import { createAccessTokenCache } from "@/lib/google/token-cache";
import type { GoogleEvent } from "@/lib/google/types";
import { optimisticRemove, optimisticUpsert } from "@/lib/optimistic";
import { buildRrule, describeRrule, parseRepeat, toEventRrule } from "@/lib/recurrence";
import { newTask, toggleTaskComplete } from "@/lib/tasks";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("all-day event end dates (review items 1 and 8)", () => {
  it("a one-day all-day draft from the month grid (exclusive end) is one day in the form and saves back as one day", () => {
    const start = d(2026, 11, 10);
    const exclusiveEnd = d(2026, 11, 11); // what the month grid passes
    const last = inclusiveLastDay(start, exclusiveEnd);
    expect(ymd(last)).toBe("2026-11-10");
    expect(exclusiveEndYmd("2026-11-10", ymd(last))).toBe("2026-11-11");
  });
  it("existing and new drafts convert the same way (multi-day)", () => {
    expect(ymd(inclusiveLastDay(d(2026, 11, 10), d(2026, 11, 13)))).toBe("2026-11-12");
    expect(exclusiveEndYmd("2026-11-10", "2026-11-12")).toBe("2026-11-13");
  });
  it("uses calendar days, so the day after spring-forward is not shifted by the lost hour", () => {
    // 2026-03-08 is 23 hours long in New York: minus 86,400,000 ms from Mar 9 00:00 lands on Mar 7.
    const start = d(2026, 3, 8);
    const end = d(2026, 3, 9);
    expect(ymd(new Date(+end - 86400000))).toBe("2026-03-07"); // the old arithmetic
    expect(ymd(inclusiveLastDay(start, end))).toBe("2026-03-08");
  });
  it("never ends before it starts, and a form end before the start saves as the start day", () => {
    expect(ymd(inclusiveLastDay(d(2026, 11, 10), d(2026, 11, 10)))).toBe("2026-11-10");
    expect(exclusiveEndYmd("2026-11-10", "2026-11-08")).toBe("2026-11-11");
  });
  it("month boundaries", () => expect(exclusiveEndYmd("2026-11-30", "2026-11-30")).toBe("2026-12-01"));
});

const cal = { id: "primary", read_only: false };
const ge = (extra: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: "a",
  etag: "e",
  start: { dateTime: "2026-11-09T15:00:00-05:00" },
  end: { dateTime: "2026-11-09T16:00:00-05:00" },
  ...extra,
});

describe("event alerts are only written when changed (review item 2)", () => {
  it("reads useDefault and every popup override", () => {
    const def = fromGoogle(ge({ reminders: { useDefault: true } }), cal);
    expect(def.reminders_default).toBe(true);
    const multi = fromGoogle(ge({ reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }, { method: "popup", minutes: 60 }] } }), cal);
    expect(multi).toMatchObject({ reminders: [10, 60], reminders_default: false });
  });
  it("an unchanged control produces no reminder fields, so default and multiple alerts survive a save", () => {
    const def = alertChoiceOf({ reminders: [], reminders_default: true });
    expect(alertPatch(def, def)).toEqual({});
    const multi = alertChoiceOf({ reminders: [10, 60], reminders_default: false });
    expect(multi).toBe(10);
    expect(alertPatch(multi, multi)).toEqual({});
    // and so the request body has no reminders key at all
    const body = toGoogleBody({ summary: "x", ...alertPatch(multi, multi) });
    expect(body).not.toHaveProperty("reminders");
  });
  it("a changed control writes exactly what was picked", () => {
    expect(alertPatch("default", 30)).toEqual({ reminders: [30] });
    expect(alertPatch(30, "none")).toEqual({ reminders: [] });
    expect(alertPatch(30, "default")).toEqual({ reminders_default: true });
    expect(toGoogleBody({ reminders_default: true }).reminders).toEqual({ useDefault: true });
    expect(toGoogleBody({ reminders: [] }).reminders).toEqual({ useDefault: false, overrides: [] });
  });
  it("a new event starts on the calendar default", () => expect(alertChoiceOf(null)).toBe("default"));
});

describe("a failed save stops the follow-up work (review item 3)", () => {
  const key = ["rows"] as const;
  const row = (id: string, v = 0) => ({ id, v });
  it("optimisticUpsert returns true and keeps the row on success", async () => {
    const qc = new QueryClient();
    qc.setQueryData(key, [row("a")]);
    const ok = await optimisticUpsert(qc, key, row("b"), async () => {}, () => {});
    expect(ok).toBe(true);
    expect(qc.getQueryData(key)).toEqual([row("a"), row("b")]);
  });
  it("optimisticUpsert rolls back, reports, and returns false on failure", async () => {
    const qc = new QueryClient();
    qc.setQueryData(key, [row("a")]);
    const errors: string[] = [];
    const ok = await optimisticUpsert(qc, key, row("a", 1), async () => { throw new Error("offline"); }, (m) => errors.push(m));
    expect(ok).toBe(false);
    expect(qc.getQueryData(key)).toEqual([row("a")]);
    expect(errors).toEqual(["Couldn't save: offline"]);
  });
  it("optimisticRemove rolls back and returns false on failure", async () => {
    const qc = new QueryClient();
    qc.setQueryData(key, [row("a")]);
    const ok = await optimisticRemove(qc, key, "a", async () => { throw new Error("nope"); }, () => {});
    expect(ok).toBe(false);
    expect(qc.getQueryData(key)).toEqual([row("a")]);
  });

  const repeating = newTask({ title: "Read", due_at: new Date(2026, 10, 9, 16).toISOString(), rrule: "RRULE:FREQ=DAILY" });
  it("a failed completion of a repeating task makes no next occurrence and shows no success toast", async () => {
    const save = vi.fn(async () => false);
    const notify = vi.fn();
    expect(await toggleTaskComplete(repeating, save, notify, new Date(2026, 10, 9, 12))).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
  it("a successful completion saves the finished task, then the next one, then announces it", async () => {
    const saved: (string | null)[] = [];
    const notify = vi.fn();
    const ok = await toggleTaskComplete(repeating, async (t) => (saved.push(t.completed_at), true), notify, new Date(2026, 10, 9, 12));
    expect(ok).toBe(true);
    expect(saved).toHaveLength(2);
    expect(saved[0]).not.toBeNull();
    expect(saved[1]).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("stops if saving the next occurrence fails", async () => {
    const notify = vi.fn();
    let n = 0;
    expect(await toggleTaskComplete(repeating, async () => ++n === 1, notify, new Date(2026, 10, 9, 12))).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
  it("unchecking just saves", async () => {
    const done = { ...repeating, completed_at: "2026-11-09T12:00:00Z" };
    const save = vi.fn(async () => true);
    await toggleTaskComplete(done, save, () => {});
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ completed_at: null }));
  });
});

describe("event repeat end (review item 4)", () => {
  const until = d(2026, 11, 9);
  it("timed events end at the end of the local day, as a UTC instant", () => {
    // 23:59:59 EST on Nov 9 is 04:59:59Z on Nov 10
    expect(buildRrule({ freq: "daily", until }, { target: "event" })).toBe("RRULE:FREQ=DAILY;UNTIL=20261110T045959Z");
  });
  it("an 8 PM occurrence on the end date still falls inside the rule", () => {
    const stamp = buildRrule({ freq: "daily", until }, { target: "event" }).match(/UNTIL=(\w+)/)![1];
    const eightPm = new Date(2026, 10, 9, 20).toISOString().replace(/[-:]|\.\d{3}/g, ""); // 20261110T010000Z
    expect(eightPm <= stamp).toBe(true);
    // the old stamp (T235959Z read as UTC) dropped it
    expect(eightPm <= "20261109T235959Z").toBe(false);
  });
  it("all-day events use a date-only UNTIL", () => expect(buildRrule({ freq: "daily", until }, { target: "event", allDay: true })).toBe("RRULE:FREQ=DAILY;UNTIL=20261109"));
  it("task rules are unchanged", () => expect(buildRrule({ freq: "daily", until })).toBe("RRULE:FREQ=DAILY;UNTIL=20261109T235959Z"));
  it("reads an event rule back as the local end date", () => {
    const r = parseRepeat("RRULE:FREQ=DAILY;UNTIL=20261110T045959Z", "event");
    expect(r && ymd(r.until!)).toBe("2026-11-09");
    expect(describeRrule("RRULE:FREQ=DAILY;UNTIL=20261110T045959Z", "event")).toBe("Every day until Nov 9");
    expect(describeRrule("RRULE:FREQ=DAILY;UNTIL=20261109")).toBe("Every day until Nov 9");
  });
  it("converts a task-style rule for Google, leaving rules without UNTIL alone", () => {
    expect(toEventRrule("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261215T235959Z")).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261216T045959Z");
    expect(toEventRrule("RRULE:FREQ=WEEKLY;BYDAY=TU")).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU");
    expect(toEventRrule("RRULE:FREQ=DAILY;UNTIL=20261215T235959Z", true)).toBe("RRULE:FREQ=DAILY;UNTIL=20261215");
  });
});

describe("due line in push notifications (review item 5)", () => {
  type Fn = (data: unknown, now: Date, locale: string) => string;
  // the same file the service worker loads with importScripts
  const load = async (): Promise<Fn> => {
    const ctx: { dueLine?: Fn } = {};
    runInNewContext(readFileSync(path.resolve(import.meta.dirname, "../public/due-line.js"), "utf8"), ctx);
    return ctx.dueLine!;
  };
  const now = new Date(2026, 10, 9, 8, 0); // Mon Nov 9
  const at = (day: number, h = 16, m = 0) => new Date(2026, 10, day, h, m).toISOString();
  it("all-day tasks say which day", async () => {
    const f = await load();
    expect(f({ due_at: at(9, 0), all_day: true }, now, "en-US")).toBe("Due today");
    expect(f({ due_at: at(10, 0), all_day: true }, now, "en-US")).toBe("Due tomorrow");
    expect(f({ due_at: at(13, 0), all_day: true }, now, "en-US")).toBe("Due Fri");
    expect(f({ due_at: at(20, 0), all_day: true }, now, "en-US")).toBe("Due Nov 20");
  });
  it("timed tasks keep the time and add the day when it isn't today", async () => {
    const f = await load();
    expect(f({ due_at: at(9, 16), all_day: false }, now, "en-US")).toMatch(/^Due 4:00\sPM$/);
    expect(f({ due_at: at(10, 16), all_day: false }, now, "en-US")).toMatch(/^Due tomorrow 4:00\sPM$/);
    expect(f({ due_at: at(13, 16), all_day: false }, now, "en-US")).toMatch(/^Due Fri 4:00\sPM$/);
  });
  it("handles no due date", async () => expect((await load())({ due_at: null }, now, "en-US")).toBe(""));
});

describe("access token cache (review item 7)", () => {
  const tok = (t: string, expiresAt: number) => async () => ({ accessToken: t, expiresAt });
  it("reuses the token for the same refresh token until it expires", async () => {
    const c = createAccessTokenCache();
    expect(await c.get("r1", tok("A", 5000), 1000)).toBe("A");
    expect(await c.get("r1", tok("B", 9000), 2000)).toBe("A");
    expect(await c.get("r1", tok("B", 9000), 6000)).toBe("B");
  });
  it("a new refresh token (after Reconnect) never gets the old token", async () => {
    const c = createAccessTokenCache();
    await c.get("old", tok("OLD", 99999), 1000);
    expect(await c.get("new", tok("NEW", 99999), 2000)).toBe("NEW");
  });
});

describe("sign-in redirect (review item 9)", () => {
  const o = "https://daybook.example";
  it("allows ordinary same-site paths", () => {
    expect(safeNextPath("/", o)).toBe("/");
    expect(safeNextPath("/settings?x=1#y", o)).toBe("/settings?x=1#y");
  });
  it.each(["//evil.com", "/\\evil.com", "/\\/evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "evil.com", "\\\\evil.com", ""])("rejects %j", (bad) => {
    expect(safeNextPath(bad, o)).toBe("/");
  });
  it("falls back for missing values", () => {
    expect(safeNextPath(null, o)).toBe("/");
    expect(safeNextPath(undefined, o)).toBe("/");
  });
});

describe("owner email source (review item 10)", () => {
  it("reads NEXT_PUBLIC_ALLOWED_EMAIL and falls back to the original address", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_EMAIL", "");
    delete process.env.NEXT_PUBLIC_ALLOWED_EMAIL;
    expect((await import("@/lib/env")).OWNER_EMAIL).toBe("sauryachunduri2@gmail.com");
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_EMAIL", "someone@example.com");
    expect((await import("@/lib/env")).OWNER_EMAIL).toBe("someone@example.com");
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

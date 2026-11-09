import { describe, expect, it, vi } from "vitest";
import { createGoogleClient } from "@/lib/google/client";
import { allEvents, mergeDelta, pruneCalendars, putEvent, shiftSeries, type EventsCache } from "@/lib/google/merge";
import { descriptionTags, fromGoogle, resolveListTags, toGoogleBody } from "@/lib/google/mapping";
import { refreshAccessToken } from "@/lib/google/token";
import type { GoogleEvent } from "@/lib/google/types";

const cal = { id: "primary", read_only: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ge = (id: string, extra: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id,
  etag: `"etag-${id}-1"`,
  summary: `Event ${id}`,
  start: { dateTime: "2026-11-09T15:00:00-05:00" },
  end: { dateTime: "2026-11-09T16:00:00-05:00" },
  ...extra,
});

function clientWith(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  return { fetchMock, client: createGoogleClient(async () => "tok", fetchMock) };
}

describe("google mapping", () => {
  it("reads dashboard metadata from extendedProperties.private", () => {
    const e = fromGoogle(
      ge("a", {
        extendedProperties: { private: { sd_list: "list-1", sd_star: "1", sd_flag: "1" } },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }, { method: "email", minutes: 60 }] },
      }),
      cal,
    );
    expect(e).toMatchObject({ list_id: "list-1", starred: true, flagged: true, reminders: [30], all_day: false });
  });
  it("detects all-day events", () => {
    const e = fromGoogle(ge("a", { start: { date: "2026-11-09" }, end: { date: "2026-11-10" } }), cal);
    expect(e.all_day).toBe(true);
    expect(e.start).toBe("2026-11-09");
  });
  it("builds patch bodies; false star/flag clears the property", () => {
    const body = toGoogleBody({ starred: false, flagged: true, list_id: "L", reminders: [10] });
    expect(body.extendedProperties?.private).toEqual({ sd_list: "L", sd_star: "", sd_flag: "1" });
    expect(body.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 10 }] });
  });
  it("never sends null property values (Google answers 400 Required) and reads cleared values back as unset", () => {
    const priv = toGoogleBody({ list_id: null, starred: false, flagged: false }).extendedProperties?.private ?? {};
    expect(Object.values(priv).every((v) => typeof v === "string")).toBe(true);
    const e = fromGoogle(ge("c", { extendedProperties: { private: priv } }), cal);
    expect(e).toMatchObject({ list_id: null, starred: false, flagged: false });
  });
  it("builds all-day vs timed start/end", () => {
    expect(toGoogleBody({ start: "2026-11-09", end: "2026-11-10", all_day: true }).start).toEqual({ date: "2026-11-09" });
    expect(toGoogleBody({ start: "2026-11-09T15:00:00Z", end: "2026-11-09T16:00:00Z" }, "America/New_York").start).toEqual({
      dateTime: "2026-11-09T15:00:00Z",
      timeZone: "America/New_York",
    });
  });
});

describe("google sync", () => {
  it("full sync uses timeMin/timeMax, pages, and records the sync token", async () => {
    const { client, fetchMock } = clientWith((url) =>
      url.includes("pageToken=p2")
        ? json({ items: [ge("b")], nextSyncToken: "SYNC1" })
        : json({ items: [ge("a")], nextPageToken: "p2" }),
    );
    const d = await client.syncEvents(cal, { timeMin: "2026-09-01T00:00:00Z", timeMax: "2027-12-01T00:00:00Z" });
    expect(d.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(d.nextSyncToken).toBe("SYNC1");
    expect(d.fullResync).toBe(true);
    const first = fetchMock.mock.calls[0][0];
    expect(first).toContain("timeMin=");
    expect(first).not.toContain("syncToken");
  });

  it("incremental sync sends the syncToken (no time bounds) and splits cancelled into deleted", async () => {
    const { client, fetchMock } = clientWith(() =>
      json({ items: [ge("a", { summary: "Renamed" }), { id: "gone", etag: "x", status: "cancelled" }], nextSyncToken: "SYNC2" }),
    );
    const d = await client.syncEvents(cal, { syncToken: "SYNC1", timeMin: "x", timeMax: "y" });
    expect(fetchMock.mock.calls[0][0]).toContain("syncToken=SYNC1");
    expect(fetchMock.mock.calls[0][0]).not.toContain("timeMin");
    expect(d.fullResync).toBe(false);
    expect(d.events[0].summary).toBe("Renamed");
    expect(d.deleted).toEqual(["gone"]);
    expect(d.nextSyncToken).toBe("SYNC2");
  });

  it("410 Gone triggers a full resync without the token", async () => {
    let n = 0;
    const { client, fetchMock } = clientWith((url) => {
      n++;
      if (url.includes("syncToken=STALE")) return json({ error: { code: 410 } }, 410);
      return json({ items: [ge("fresh")], nextSyncToken: "SYNC9" });
    });
    const d = await client.syncEvents(cal, { syncToken: "STALE", timeMin: "2026-09-01T00:00:00Z", timeMax: "2027-12-01T00:00:00Z" });
    expect(n).toBe(2);
    expect(fetchMock.mock.calls[1][0]).toContain("timeMin=");
    expect(fetchMock.mock.calls[1][0]).not.toContain("syncToken");
    expect(d.fullResync).toBe(true);
    expect(d.nextSyncToken).toBe("SYNC9");
  });
});

describe("delta merge", () => {
  const base: EventsCache = {
    primary: { syncToken: "S1", events: { a: fromGoogle(ge("a"), cal), b: fromGoogle(ge("b"), cal) } },
    other: { syncToken: "O1", events: { z: fromGoogle(ge("z"), { id: "other", read_only: true }) } },
  };
  it("applies upserts and deletes without touching other calendars", () => {
    const next = mergeDelta(base, {
      calendarId: "primary",
      events: [fromGoogle(ge("a", { summary: "New" }), cal), fromGoogle(ge("c"), cal)],
      deleted: ["b"],
      nextSyncToken: "S2",
      fullResync: false,
    });
    expect(Object.keys(next.primary.events).sort()).toEqual(["a", "c"]);
    expect(next.primary.events.a.summary).toBe("New");
    expect(next.primary.syncToken).toBe("S2");
    expect(next.other).toBe(base.other);
  });
  it("a full resync discards stale cached events", () => {
    const next = mergeDelta(base, { calendarId: "primary", events: [fromGoogle(ge("c"), cal)], deleted: [], nextSyncToken: "S3", fullResync: true });
    expect(Object.keys(next.primary.events)).toEqual(["c"]);
  });
  it("keeps the old token if Google returns none", () => {
    const next = mergeDelta(base, { calendarId: "primary", events: [], deleted: [], nextSyncToken: null, fullResync: false });
    expect(next.primary.syncToken).toBe("S1");
  });
  it("prunes disabled calendars", () => {
    expect(Object.keys(pruneCalendars(base, ["primary"]))).toEqual(["primary"]);
    expect(allEvents(pruneCalendars(base, ["primary"]))).toHaveLength(2);
  });
  it("shifts a whole series by the dragged instance's delta", () => {
    const s = shiftSeries(
      { start: "2026-11-02T20:00:00.000Z", end: "2026-11-02T21:00:00.000Z", all_day: false },
      { start: "2026-11-09T20:00:00.000Z", end: "2026-11-09T21:00:00.000Z" },
      { start: "2026-11-09T21:00:00.000Z", end: "2026-11-09T22:30:00.000Z" },
    );
    expect(s).toEqual({ start: "2026-11-02T21:00:00.000Z", end: "2026-11-02T22:30:00.000Z" });
  });
});

describe("google writes", () => {
  it("sends If-Match with the etag and returns the updated event", async () => {
    const { client, fetchMock } = clientWith(() => json(ge("a", { etag: '"etag-a-2"', summary: "Moved" })));
    const r = await client.patchEvent(cal, "a", { summary: "Moved" }, '"etag-a-1"');
    expect(r.ok).toBe(true);
    const init = fetchMock.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"etag-a-1"');
    expect(init.method).toBe("PATCH");
    if (r.ok) expect(r.event.etag).toBe('"etag-a-2"');
  });
  it("on a stale etag (412) re-applies the edit once on Google's latest version", async () => {
    let patches = 0;
    const { client, fetchMock } = clientWith((_url, init) => {
      if (init?.method === "PATCH") {
        patches++;
        return patches === 1 ? json({ error: { code: 412 } }, 412) : json(ge("a", { etag: '"etag-a-10"', summary: "Mine" }));
      }
      return json(ge("a", { etag: '"etag-a-9"', summary: "Edited in Google" }));
    });
    const r = await client.patchEvent(cal, "a", { summary: "Mine" }, '"stale"');
    if (!r.ok) throw new Error("expected the retry to succeed");
    expect(r.event.summary).toBe("Mine");
    const retry = fetchMock.mock.calls[2][1]!;
    expect((retry.headers as Record<string, string>)["If-Match"]).toBe('"etag-a-9"');
  });
  it("if the retry also conflicts, Google wins and the latest copy is returned", async () => {
    const { client } = clientWith((_url, init) =>
      init?.method === "PATCH" ? json({ error: { code: 412 } }, 412) : json(ge("a", { etag: '"etag-a-9"', summary: "Edited in Google" })),
    );
    const r = await client.patchEvent(cal, "a", { summary: "Mine" }, '"stale"');
    if (r.ok || !("conflict" in r)) throw new Error("expected conflict");
    expect(r.event.summary).toBe("Edited in Google");
    expect(putEvent({}, r.event).primary.events.a.summary).toBe("Edited in Google");
  });
  it("editing an event Google already deleted (cancelled) reports deleted, never a 'cancelled' block", async () => {
    const { client } = clientWith((_url, init) =>
      init?.method === "PATCH" ? json({ error: { code: 412 } }, 412) : json(ge("a", { status: "cancelled" })),
    );
    const r = await client.patchEvent(cal, "a", { list_id: "L" }, '"stale"');
    expect(r).toEqual({ ok: false, deleted: true });
  });
  it("delete conflict returns the latest event; 404/410 and already-cancelled count as deleted", async () => {
    const c1 = clientWith((_url, init) => (init?.method === "DELETE" ? json({}, 412) : json(ge("a", { etag: '"new"' }))));
    const r1 = await c1.client.deleteEvent(cal, "a", '"old"');
    expect(r1.ok).toBe(false);
    const c2 = clientWith(() => new Response("", { status: 410 }));
    expect((await c2.client.deleteEvent(cal, "a", null)).ok).toBe(true);
    const c3 = clientWith((_url, init) => (init?.method === "DELETE" ? json({ error: "bad" }, 400) : json(ge("a", { status: "cancelled" }))));
    expect((await c3.client.deleteEvent(cal, "a", '"old"')).ok).toBe(true);
  });
  it("insert posts the event and maps the response", async () => {
    const { client, fetchMock } = clientWith(() => json(ge("new")));
    const e = await client.insertEvent(cal, { summary: "Hi", start: "2026-11-09T15:00:00Z", end: "2026-11-09T16:00:00Z" }, "America/New_York");
    expect(e.id).toBe("new");
    expect(fetchMock.mock.calls[0][1]!.method).toBe("POST");
  });
  it("surfaces non-2xx as GoogleApiError", async () => {
    const { client } = clientWith(() => json({ error: "nope" }, 403));
    await expect(client.listCalendars()).rejects.toMatchObject({ status: 403 });
  });
});

describe("token refresh", () => {
  it("returns an access token with expiry", async () => {
    const f = vi.fn(async () => json({ access_token: "AT", expires_in: 3600 }));
    const t = await refreshAccessToken({ clientId: "i", clientSecret: "s", refreshToken: "r", fetch: f }, 1000);
    expect(t.accessToken).toBe("AT");
    expect(t.expiresAt).toBe(1000 + 3600_000 - 60_000);
  });
  it("maps invalid_grant to a 401", async () => {
    const f = vi.fn(async () => json({ error: "invalid_grant" }, 400));
    await expect(refreshAccessToken({ clientId: "i", clientSecret: "s", refreshToken: "r", fetch: f })).rejects.toMatchObject({ status: 401 });
  });
});

describe("description tags", () => {
  const lists = [
    { id: "hosa", name: "HOSA" },
    { id: "psych", name: "AP Psych" },
    { id: "rt", name: "Remember Together" },
  ];

  it("reads #todo and #list: from the description", () => {
    expect(descriptionTags("Outline intro\n#todo #list:HOSA")).toEqual({ todo: true, list: "HOSA" });
    expect(descriptionTags("<p>#TODO</p><p>#list:ap-psych</p>")).toEqual({ todo: true, list: "ap-psych" });
    expect(descriptionTags("see example.com/#todo and ##todo or foo#todo")).toEqual({ todo: false, list: null });
    expect(descriptionTags("#todos for later")).toEqual({ todo: false, list: null });
  });

  it("puts a tagged event on the to-do list and keeps the list name", () => {
    const e = fromGoogle(ge("t", { description: "Chunk 1 of 3\n#todo #list:HOSA" }), cal);
    expect(e.todo).toBe(true);
    expect(e.list_id).toBeNull();
    expect(e.list_tag).toBe("HOSA");
  });

  it("lets the dashboard's own values win over tags, including a cleared value", () => {
    const cleared = fromGoogle(
      ge("t", { description: "#todo #list:HOSA", extendedProperties: { private: { sd_todo: "", sd_list: "" } } }),
      cal,
    );
    expect(cleared.todo).toBe(false);
    expect(cleared.list_id).toBeNull();
    expect(cleared.list_tag).toBeNull();
    const set = fromGoogle(ge("t", { description: "#list:HOSA", extendedProperties: { private: { sd_list: "psych" } } }), cal);
    expect(set.list_id).toBe("psych");
    expect(set.list_tag).toBeNull();
  });

  it("untagged events are unchanged", () => {
    const e = fromGoogle(ge("t", { description: "Bring calculator" }), cal);
    expect(e.todo).toBe(false);
    expect(e.list_tag).toBeNull();
  });

  it("resolves #list: names to list ids, ignoring case, spaces, - and _", () => {
    const mk = (id: string, list_tag: string | null, list_id: string | null = null) =>
      ({ ...fromGoogle(ge(id), cal), list_tag, list_id });
    const out = resolveListTags(
      [mk("a", "hosa"), mk("b", "AP-Psych"), mk("c", "remember_together"), mk("d", "Nope"), mk("e", "HOSA", "psych"), mk("f", null)],
      lists,
    );
    expect(out.map((e) => e.list_id)).toEqual(["hosa", "psych", "rt", null, "psych", null]);
  });
});

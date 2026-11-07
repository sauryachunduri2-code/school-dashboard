import type { CalendarRow, GEvent } from "../types";
import { fromGoogle, toGoogleBody, type EventPatch } from "./mapping";
import {
  GoogleApiError,
  type FetchLike,
  type GoogleCalendarListEntry,
  type GoogleEvent,
  type GoogleEventsPage,
} from "./types";

const BASE = "https://www.googleapis.com/calendar/v3";

export interface GoogleClient {
  listCalendars(): Promise<GoogleCalendarListEntry[]>;
  syncEvents(cal: Pick<CalendarRow, "id" | "read_only">, opts: SyncOptions): Promise<SyncDelta>;
  getEvent(calendarId: string, eventId: string): Promise<GoogleEvent>;
  insertEvent(cal: Pick<CalendarRow, "id" | "read_only">, patch: EventPatch, tz?: string): Promise<GEvent>;
  patchEvent(
    cal: Pick<CalendarRow, "id" | "read_only">,
    eventId: string,
    patch: EventPatch,
    etag: string | null,
    tz?: string,
  ): Promise<WriteResult>;
  deleteEvent(cal: Pick<CalendarRow, "id" | "read_only">, eventId: string, etag: string | null): Promise<DeleteResult>;
}

export interface SyncOptions {
  syncToken?: string | null;
  timeMin: string;
  timeMax: string;
}

export interface SyncDelta {
  calendarId: string;
  events: GEvent[];
  deleted: string[];
  nextSyncToken: string | null;
  /** True when the caller must discard its cached events for this calendar. */
  fullResync: boolean;
}

export type WriteResult =
  | { ok: true; event: GEvent }
  | { ok: false; conflict: true; event: GEvent }
  /** The event no longer exists in Google (deleted elsewhere). */
  | { ok: false; deleted: true };
export type DeleteResult = { ok: true } | { ok: false; conflict: true; event: GEvent | null };

export function createGoogleClient(getAccessToken: () => Promise<string>, fetchImpl: FetchLike = fetch as FetchLike): GoogleClient {
  async function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    const token = await getAccessToken();
    const res = await fetchImpl(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    return res;
  }

  async function json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GoogleApiError(res.status, text || res.statusText);
    }
    return (await res.json()) as T;
  }

  const enc = encodeURIComponent;

  async function listPages(calendarId: string, params: URLSearchParams) {
    const items: GoogleEvent[] = [];
    let nextSyncToken: string | null = null;
    let pageToken: string | undefined;
    do {
      const p = new URLSearchParams(params);
      if (pageToken) p.set("pageToken", pageToken);
      const res = await call(`/calendars/${enc(calendarId)}/events?${p}`);
      if (res.status === 410) throw new GoogleApiError(410, "sync token expired");
      const page = await json<GoogleEventsPage>(res);
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return { items, nextSyncToken };
  }

  return {
    async listCalendars() {
      const res = await call(`/users/me/calendarList?minAccessRole=reader&maxResults=250`);
      const body = await json<{ items?: GoogleCalendarListEntry[] }>(res);
      return body.items ?? [];
    },

    async syncEvents(cal, opts) {
      const base = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "250" });
      let fullResync = !opts.syncToken;
      let result: { items: GoogleEvent[]; nextSyncToken: string | null };
      try {
        const params = new URLSearchParams(base);
        if (opts.syncToken) params.set("syncToken", opts.syncToken);
        else {
          params.set("timeMin", opts.timeMin);
          params.set("timeMax", opts.timeMax);
        }
        result = await listPages(cal.id, params);
      } catch (e) {
        if (e instanceof GoogleApiError && e.status === 410) {
          // Token invalidated: throw away deltas and rebuild from scratch.
          const params = new URLSearchParams(base);
          params.set("timeMin", opts.timeMin);
          params.set("timeMax", opts.timeMax);
          result = await listPages(cal.id, params);
          fullResync = true;
        } else throw e;
      }
      const events: GEvent[] = [];
      const deleted: string[] = [];
      for (const raw of result.items) {
        if (raw.status === "cancelled") deleted.push(raw.id);
        else events.push(fromGoogle(raw, cal));
      }
      return { calendarId: cal.id, events, deleted, nextSyncToken: result.nextSyncToken, fullResync };
    },

    async getEvent(calendarId, eventId) {
      return json<GoogleEvent>(await call(`/calendars/${enc(calendarId)}/events/${enc(eventId)}`));
    },

    async insertEvent(cal, patch, tz) {
      const res = await call(`/calendars/${enc(cal.id)}/events`, {
        method: "POST",
        body: JSON.stringify(toGoogleBody(patch, tz)),
      });
      return fromGoogle(await json<GoogleEvent>(res), cal);
    },

    async patchEvent(cal, eventId, patch, etag, tz) {
      const res = await call(`/calendars/${enc(cal.id)}/events/${enc(eventId)}`, {
        method: "PATCH",
        headers: etag ? { "If-Match": etag } : {},
        body: JSON.stringify(toGoogleBody(patch, tz)),
      });
      if (res.status === 412) {
        // Our copy was stale. Usually that's just our own earlier write or a background sync racing,
        // so re-apply this explicit edit once on top of Google's latest version (unless it was deleted).
        const latest = await this.getEvent(cal.id, eventId).catch(() => null);
        if (!latest || latest.status === "cancelled") return { ok: false, deleted: true };
        const retry = await call(`/calendars/${enc(cal.id)}/events/${enc(eventId)}`, {
          method: "PATCH",
          headers: latest.etag ? { "If-Match": latest.etag } : {},
          body: JSON.stringify(toGoogleBody(patch, tz)),
        });
        if (retry.status === 412) return { ok: false, conflict: true, event: fromGoogle(await this.getEvent(cal.id, eventId), cal) };
        return { ok: true, event: fromGoogle(await json<GoogleEvent>(retry), cal) };
      }
      if (res.status === 404 || res.status === 410) return { ok: false, deleted: true };
      const saved = await json<GoogleEvent>(res);
      if (saved.status === "cancelled") return { ok: false, deleted: true };
      return { ok: true, event: fromGoogle(saved, cal) };
    },

    async deleteEvent(cal, eventId, etag) {
      const res = await call(`/calendars/${enc(cal.id)}/events/${enc(eventId)}`, {
        method: "DELETE",
        headers: etag ? { "If-Match": etag } : {},
      });
      if (res.status === 412) {
        const latest = await this.getEvent(cal.id, eventId).catch(() => null);
        return { ok: false, conflict: true, event: latest ? fromGoogle(latest, cal) : null };
      }
      if (!res.ok && res.status !== 410 && res.status !== 404) {
        // Deleting something Google already deleted can answer 400; treat "already gone" as done.
        const latest = await this.getEvent(cal.id, eventId).catch(() => null);
        if (!latest || latest.status === "cancelled") return { ok: true };
        throw new GoogleApiError(res.status, await res.text().catch(() => res.statusText));
      }
      return { ok: true };
    },
  };
}

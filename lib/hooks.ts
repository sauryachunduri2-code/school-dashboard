"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { repo } from "./data/repo";
import { localMode } from "./env";
import { allEvents, mergeDelta, pruneCalendars, putEvent, removeEvent, setSeriesTodo, type EventsCache } from "./google/merge";
import type { SyncDelta } from "./google/client";
import { resolveListTags, type EventPatch } from "./google/mapping";
import { DEFAULT_REMINDER_SETTINGS, DEFAULT_SETTINGS_ROW, sanitizeSettings, type ReminderSettings } from "./reminders";
import { EVENT_CHECKS_KEY, toggleEventCheck, type EventCheck } from "./event-checks";
import { optimisticRemove, optimisticUpsert } from "./optimistic";
import { newTask, toggleTaskComplete } from "./tasks";
import { useUi } from "./ui";
import type { CalendarRow, GEvent, HoursLog, List, RowOf, Table, Task } from "./types";
import { uid } from "./dates";

const REFRESH_MS = 60_000;

export function useRows<T extends Table>(table: T) {
  return useQuery<RowOf<T>[]>({
    queryKey: [table],
    queryFn: () => repo.list(table),
    refetchInterval: REFRESH_MS,
  });
}

export function useLists(): List[] {
  const { data } = useRows("lists");
  return useMemo(() => [...(data ?? [])].sort((a, b) => a.sort - b.sort), [data]);
}
export const useTasks = (): Task[] => useRows("tasks").data ?? [];

/** Default-reminder settings (one shared row). Falls back to the defaults until it loads or if the row is missing. */
export function useReminderSettings(): ReminderSettings {
  const { data } = useRows("settings");
  const row = data?.[0];
  return useMemo(() => (row ? sanitizeSettings(row) : DEFAULT_REMINDER_SETTINGS), [row]);
}

/** Save the default-reminder settings. */
export function useSaveReminderSettings() {
  const { upsert } = useRowMutations("settings");
  const current = useReminderSettings();
  return useCallback((patch: Partial<ReminderSettings>) => upsert({ ...DEFAULT_SETTINGS_ROW, ...current, ...patch }), [upsert, current]);
}
export const useHours = (): HoursLog[] => useRows("hours_logs").data ?? [];

/** Optimistic upsert/remove for one table. Failure rolls back, tells the user, and resolves false so callers can stop. */
export function useRowMutations<T extends Table>(table: T) {
  const qc = useQueryClient();
  const { toast } = useUi();

  const upsert = useCallback(
    (row: RowOf<T>): Promise<boolean> => optimisticUpsert(qc, [table], row, (r) => repo.upsert(table, r), toast),
    [qc, table, toast],
  );

  const remove = useCallback(
    (id: string): Promise<boolean> => optimisticRemove<RowOf<T>>(qc, [table], id, (i) => repo.remove(table, i), toast),
    [qc, table, toast],
  );
  return { upsert, remove };
}

export function useTaskActions() {
  const { upsert, remove } = useRowMutations("tasks");
  const { toast } = useUi();

  /** Resolves to the saved task, or null when the save failed (the user has already been told). */
  const create = useCallback(
    async (partial: Partial<Task> & { title: string }) => {
      const t = newTask(partial);
      return (await upsert(t)) ? t : null;
    },
    [upsert],
  );

  const update = useCallback(
    async (task: Task, patch: Partial<Task>) => {
      const next = { ...task, ...patch, updated_at: new Date().toISOString() };
      return (await upsert(next)) ? next : null;
    },
    [upsert],
  );

  const toggleComplete = useCallback((task: Task) => toggleTaskComplete(task, upsert, toast), [upsert, toast]);

  return { create, update, toggleComplete, remove };
}

// ---------------------------------------------------------------- event checks

/** Per-day checks of to-do events. Empty until loaded, or if migration 0006 hasn't been applied yet. */
export function useEventChecks(): EventCheck[] {
  const { data } = useQuery<EventCheck[]>({
    queryKey: EVENT_CHECKS_KEY,
    queryFn: () => repo.listEventChecks(),
    refetchInterval: REFRESH_MS,
  });
  return data ?? [];
}

/** Check/uncheck an event for a day. Dashboard only: Google isn't modified. */
export function useEventCheckToggle() {
  const qc = useQueryClient();
  const { toast } = useUi();
  return useCallback(
    (event: GEvent, day: Date) =>
      toggleEventCheck(qc, { put: (c) => repo.putEventCheck(c), del: (c) => repo.deleteEventCheck(c) }, event, day, toast),
    [qc, toast],
  );
}

// ---------------------------------------------------------------- Google

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
}

export function useGoogleStatus() {
  return useQuery<GoogleStatus>({
    queryKey: ["google-status"],
    queryFn: async () => {
      if (localMode) return { configured: false, connected: false };
      const res = await fetch("/api/google/status");
      if (!res.ok) throw new Error("status failed");
      return res.json();
    },
    staleTime: 60_000,
  });
}

export const useCalendars = (): CalendarRow[] => useRows("calendars").data ?? [];

async function post<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

/** Incremental sync for every enabled calendar; deltas are merged into the persisted cache. */
export function useGoogleEvents(): GEvent[] {
  const qc = useQueryClient();
  // DEV-ONLY: in local mode there is no Google, so events can be loaded from IndexedDB fixtures
  // (key "dev-local:gevents") to exercise the calendar UI. Writes aren't wired to anything.
  const dev = useQuery<GEvent[]>({
    queryKey: ["dev-gevents"],
    enabled: localMode,
    queryFn: async () => (await idbGet<GEvent[]>("dev-local:gevents")) ?? [],
  });
  const { data: status } = useGoogleStatus();
  const calendars = useCalendars();
  const lists = useLists();
  const enabled = useMemo(() => calendars.filter((c) => c.enabled), [calendars]);
  const enabledKey = enabled.map((c) => c.id).join("|");

  const { data } = useQuery<EventsCache>({
    queryKey: ["gevents"],
    enabled: !!status?.connected && enabled.length > 0,
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
    queryFn: async () => {
      const before = qc.getQueryData<EventsCache>(["gevents"]);
      const deltas = await Promise.allSettled(
        enabled.map((c) => post<SyncDelta>("/api/google/sync", "POST", { calendarId: c.id, syncToken: before?.[c.id]?.syncToken ?? null })),
      );
      // Merge into the cache as it is *now*, so edits saved while the sync was in flight aren't overwritten.
      let cache = pruneCalendars(qc.getQueryData<EventsCache>(["gevents"]), enabled.map((c) => c.id));
      for (const d of deltas) if (d.status === "fulfilled") cache = mergeDelta(cache, d.value);
      return cache;
    },
  });
  // Calendars toggled in Settings: re-sync and drop events of disabled calendars immediately.
  const visible = useMemo(() => {
    const ids = new Set(enabledKey ? enabledKey.split("|") : []);
    return resolveListTags(allEvents(data).filter((e) => ids.has(e.calendar_id)), lists);
  }, [data, enabledKey, lists]);
  return localMode ? (dev.data ?? []) : visible;
}

function applyPatch(e: GEvent, p: EventPatch): GEvent {
  return {
    ...e,
    summary: p.summary ?? e.summary,
    description: p.description ?? e.description,
    start: p.start ?? e.start,
    end: p.end ?? e.end,
    all_day: p.all_day ?? e.all_day,
    list_id: p.list_id === undefined ? e.list_id : p.list_id,
    // A list picked in the editor replaces any #list: tag, as it does once Google returns the saved event.
    list_tag: p.list_id === undefined ? e.list_tag : null,
    starred: p.starred ?? e.starred,
    flagged: p.flagged ?? e.flagged,
    todo: p.todo ?? e.todo,
    reminders: p.reminders ?? e.reminders,
    reminders_default: p.reminders_default ? true : p.reminders !== undefined ? false : e.reminders_default,
  };
}

/**
 * DEV-ONLY: in local mode there is no Google, so an edit is applied to the IndexedDB fixture events
 * (key "dev-local:gevents", see useGoogleEvents) so the editor and the to-do flag can be exercised.
 */
async function updateLocalEvent(qc: QueryClient, event: GEvent, patch: EventPatch) {
  const rows = (await idbGet<GEvent[]>("dev-local:gevents")) ?? [];
  const next = rows.map((r) => {
    if (r.calendar_id !== event.calendar_id) return r;
    if (r.id === event.id) return applyPatch(r, patch);
    // the to-do flag is shared by the whole series
    if (patch.todo !== undefined && event.recurring_event_id && r.recurring_event_id === event.recurring_event_id) return { ...r, todo: patch.todo };
    return r;
  });
  await idbSet("dev-local:gevents", next);
  qc.setQueryData(["dev-gevents"], next);
}

export type SeriesScope = "this" | "all";

export function useEventActions() {
  const qc = useQueryClient();
  const { toast } = useUi();
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  const set = (fn: (c: EventsCache | undefined) => EventsCache) => {
    qc.setQueryData<EventsCache>(["gevents"], (c) => fn(c));
  };
  const refetch = () => qc.invalidateQueries({ queryKey: ["gevents"] });

  const create = useCallback(
    async (calendarId: string, patch: EventPatch) => {
      try {
        const res = await post<{ event: GEvent }>("/api/google/events", "POST", { calendarId, patch, tz });
        set((c) => putEvent(c, res.event));
        return res.event;
      } catch (e) {
        toast(`Couldn't create event: ${e instanceof Error ? e.message : "error"}`);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, toast, tz],
  );

  const update = useCallback(
    async (event: GEvent, patch: EventPatch, scope: SeriesScope = "this") => {
      if (event.read_only) return;
      if (localMode) return updateLocalEvent(qc, event, patch);
      const optimistic = applyPatch(event, patch);
      // A recurring event's to-do flag is stored on the series master, so every occurrence flips at once.
      const flipSeries = patch.todo !== undefined && !!event.recurring_event_id;
      if (scope === "this" || flipSeries) {
        set((c) => {
          const next = putEvent(c, optimistic);
          return flipSeries ? setSeriesTodo(next, event.calendar_id, event.recurring_event_id!, patch.todo!) : next;
        });
      }
      try {
        const res = await post<{ ok: boolean; conflict?: boolean; deleted?: boolean; event: GEvent }>("/api/google/events", "PATCH", {
          calendarId: event.calendar_id,
          eventId: event.id,
          etag: event.etag,
          patch,
          tz,
          scope,
          recurringEventId: event.recurring_event_id,
          instanceBefore: { start: event.start, end: event.end },
        });
        if (res.deleted) {
          set((c) => removeEvent(c, event.calendar_id, event.id));
          toast("That event was deleted in Google Calendar.");
        } else if (res.conflict) {
          set((c) => putEvent(c, res.event));
          toast("That event changed in Google Calendar, so I kept Google's version.");
        } else if (scope === "all" || flipSeries) {
          await refetch();
        } else {
          set((c) => putEvent(c, res.event));
        }
      } catch (e) {
        set((c) => {
          const back = putEvent(c, event);
          return flipSeries ? setSeriesTodo(back, event.calendar_id, event.recurring_event_id!, event.todo) : back;
        });
        void refetch();
        toast(`Couldn't update event: ${e instanceof Error ? e.message : "error"}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, toast, tz],
  );

  const remove = useCallback(
    async (event: GEvent, scope: SeriesScope = "this") => {
      if (event.read_only) return;
      if (scope === "this") set((c) => removeEvent(c, event.calendar_id, event.id));
      try {
        const res = await post<{ ok: boolean; conflict?: boolean; event: GEvent | null }>("/api/google/events", "DELETE", {
          calendarId: event.calendar_id,
          eventId: event.id,
          etag: event.etag,
          scope,
          recurringEventId: event.recurring_event_id,
        });
        if (res.conflict) {
          if (res.event) set((c) => putEvent(c, res.event!));
          toast("That event changed in Google Calendar, so it wasn't deleted.");
        } else if (scope === "all") await refetch();
      } catch (e) {
        set((c) => putEvent(c, event));
        void refetch();
        toast(`Couldn't delete event: ${e instanceof Error ? e.message : "error"}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, toast],
  );

  return { create, update, remove };
}

export function newHoursLog(p: Partial<HoursLog> & { date: string; hours: number }): HoursLog {
  return { id: uid(), list_id: null, note: "", created_at: new Date().toISOString(), ...p };
}

export { useMutation };

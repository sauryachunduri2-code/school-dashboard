import { get, set } from "idb-keyval";
import { localMode } from "../env";
import { DEFAULT_SETTINGS_ROW, normalizeTask } from "../reminders";
import { SEED_LISTS } from "../seed";
import { supabaseBrowser } from "../supabase/browser";
import { checkIdOf, withCheck, withoutCheck, type EventCheck } from "../event-checks";
import type { RowOf, Table, Task } from "../types";

export interface Repo {
  list<T extends Table>(table: T): Promise<RowOf<T>[]>;
  upsert<T extends Table>(table: T, row: RowOf<T>): Promise<void>;
  remove(table: Table, id: string): Promise<void>;
  /** Per-day checks of to-do events (composite key, so they don't go through the id-based methods). */
  listEventChecks(): Promise<EventCheck[]>;
  putEventCheck(check: EventCheck): Promise<void>;
  deleteEventCheck(check: Pick<EventCheck, "calendar_id" | "event_key" | "day">): Promise<void>;
}

const supabaseRepo: Repo = {
  async list(table) {
    const { data, error } = await supabaseBrowser().from(table).select("*");
    if (error) throw new Error(error.message);
    return (data ?? []) as never;
  },
  async upsert(table, row) {
    const { error } = await supabaseBrowser().from(table).upsert(row as never);
    if (error) throw new Error(error.message);
  },
  async remove(table, id) {
    const { error } = await supabaseBrowser().from(table).delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
  async listEventChecks() {
    const { data, error } = await supabaseBrowser().from("event_checks").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []) as EventCheck[];
  },
  async putEventCheck(check) {
    const { error } = await supabaseBrowser().from("event_checks").upsert(check, { onConflict: "calendar_id,event_key,day" });
    if (error) throw new Error(error.message);
  },
  async deleteEventCheck({ calendar_id, event_key, day }) {
    const { error } = await supabaseBrowser().from("event_checks").delete().eq("calendar_id", calendar_id).eq("event_key", event_key).eq("day", day);
    if (error) throw new Error(error.message);
  },
};

/** DEV-ONLY: IndexedDB-backed stand-in used when Supabase isn't configured (see lib/env.ts). */
const localRepo: Repo = {
  async list(table) {
    const key = `dev-local:${table}`;
    const rows = await get(key);
    if (rows) {
      // Tasks saved before reminders were reworked (remind_at / remind_offset) are converted once, like migration 0004.
      if (table === "tasks" && (rows as Task[]).some((t) => !Array.isArray(t.reminders))) {
        const migrated = (rows as Task[]).map((t) => normalizeTask(t));
        await set(key, migrated);
        return migrated as never;
      }
      return rows;
    }
    const initial = table === "lists" ? SEED_LISTS : table === "settings" ? [DEFAULT_SETTINGS_ROW] : [];
    await set(key, initial);
    return initial as never;
  },
  async upsert(table, row) {
    const rows = ((await this.list(table)) as { id: string }[]).slice();
    const i = rows.findIndex((r) => r.id === (row as { id: string }).id);
    if (i >= 0) rows[i] = row as never;
    else rows.push(row as never);
    await set(`dev-local:${table}`, rows);
  },
  async remove(table, id) {
    const rows = ((await this.list(table)) as { id: string }[]).filter((r) => r.id !== id);
    await set(`dev-local:${table}`, rows);
  },
  async listEventChecks() {
    return (await get<EventCheck[]>("dev-local:event_checks")) ?? [];
  },
  async putEventCheck(check) {
    await set("dev-local:event_checks", withCheck(await this.listEventChecks(), check));
  },
  async deleteEventCheck(check) {
    await set("dev-local:event_checks", withoutCheck(await this.listEventChecks(), checkIdOf(check)));
  },
};

export const repo: Repo = localMode ? localRepo : supabaseRepo;

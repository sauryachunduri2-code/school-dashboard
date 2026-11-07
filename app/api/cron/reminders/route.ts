import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runReminders } from "@/lib/cron";
import { sendPush } from "@/lib/push";
import { sanitizeSettings } from "@/lib/reminders";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { List, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = supabaseAdmin();
  const result = await runReminders({
    now: new Date(),
    async loadSettings() {
      // A missing table/row (migration 0004 not applied yet) falls back to the defaults.
      const { data } = await db.from("settings").select("default_remind_offset, allday_remind_minutes").eq("id", 1).maybeSingle();
      return sanitizeSettings(data);
    },
    async loadCandidates({ dueFrom, dueTo }) {
      const { data, error } = await db.rpc("reminder_candidates", { due_from: dueFrom.toISOString(), due_to: dueTo.toISOString() });
      if (error) throw new Error(error.message);
      return (data ?? []) as Task[];
    },
    async loadSends(ids, since) {
      const { data, error } = await db.from("reminder_sends").select("task_id, remind_at").in("task_id", ids).gte("remind_at", since.toISOString());
      // Don't guess: treating a failed read as "nothing sent yet" would re-send everything.
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async loadLists() {
      const { data } = await db.from("lists").select("*");
      return (data ?? []) as List[];
    },
    async loadSubscriptions() {
      const { data } = await db.from("push_subscriptions").select("endpoint, p256dh, auth");
      return data ?? [];
    },
    send: sendPush,
    async recordSend(task, fireAts) {
      // One row per (task, fire time): that pair is what makes a reminder "already sent".
      const { error } = await db
        .from("reminder_sends")
        .upsert(fireAts.map((at) => ({ task_id: task.id, remind_at: at.toISOString() })), { onConflict: "task_id,remind_at" });
      if (error) throw new Error(error.message);
    },
    async deleteSubscriptions(endpoints) {
      await db.from("push_subscriptions").delete().in("endpoint", endpoints);
    },
  });
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;

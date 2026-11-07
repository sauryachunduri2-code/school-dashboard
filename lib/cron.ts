import { candidateWindow, MAX_AGE_MS, reminderPayload, selectDueReminders, type ReminderSend, type ReminderSettings } from "./reminders";
import type { StoredSubscription, PushResult } from "./push";
import type { List, Task } from "./types";

/** Everything the reminder run needs from the outside world, injectable for tests. */
export interface ReminderDeps {
  now: Date;
  loadSettings(): Promise<ReminderSettings>;
  /** Open tasks that may have a reminder in the recent past: due inside the window, or with custom reminders. */
  loadCandidates(win: { dueFrom: Date; dueTo: Date }): Promise<Task[]>;
  loadSends(taskIds: string[], since: Date): Promise<ReminderSend[]>;
  loadLists(): Promise<List[]>;
  loadSubscriptions(): Promise<StoredSubscription[]>;
  send(subs: StoredSubscription[], payload: unknown): Promise<PushResult>;
  /** Record every fire time covered by one delivered push. */
  recordSend(task: Task, fireAts: Date[]): Promise<void>;
  deleteSubscriptions(endpoints: string[]): Promise<void>;
}

export async function runReminders(d: ReminderDeps) {
  const since = new Date(+d.now - MAX_AGE_MS);
  const [settings, candidates] = await Promise.all([d.loadSettings(), d.loadCandidates(candidateWindow(d.now))]);
  if (!candidates.length) return { due: 0, sent: 0 };
  const sends = await d.loadSends(candidates.map((t) => t.id), since);
  const due = selectDueReminders(candidates, sends, d.now, settings);
  if (!due.length) return { due: 0, sent: 0 };

  let subs = await d.loadSubscriptions();
  // No device subscribed yet: leave unsent so it can still fire once one is (within the age window).
  if (!subs.length) return { due: due.length, sent: 0 };

  const lists = await d.loadLists();
  let sent = 0;
  for (const { task, fireAts } of due) {
    const list = lists.find((l) => l.id === task.list_id);
    // One push per task per run, even if several of its reminder times are due (e.g. after an outage).
    const res = await d.send(subs, reminderPayload(task, list?.name));
    if (res.gone.length) {
      await d.deleteSubscriptions(res.gone);
      // Don't resend to dead endpoints for the rest of this run.
      subs = subs.filter((s) => !res.gone.includes(s.endpoint));
    }
    if (res.delivered > 0) {
      await d.recordSend(task, fireAts);
      sent++;
    }
  }
  return { due: due.length, sent };
}

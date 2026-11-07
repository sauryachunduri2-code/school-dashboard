import { nextOccurrence } from "./recurrence";
import type { List, Task } from "./types";
import { uid } from "./dates";
import { carryReminders } from "./reminders";

export function newTask(partial: Partial<Task> & { title: string }): Task {
  const now = new Date().toISOString();
  return {
    id: uid(),
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
    created_at: now,
    updated_at: now,
    ...partial,
  };
}

/**
 * Complete a task. A repeating task spawns its next occurrence (like Apple Reminders):
 * the finished one stays in Completed, and a fresh one appears with the next due date.
 */
export function completeTask(task: Task, now = new Date()): { completed: Task; next: Task | null } {
  const stamp = now.toISOString();
  const completed: Task = { ...task, completed_at: stamp, updated_at: stamp };
  if (!task.rrule || !task.due_at) return { completed, next: null };

  const due = new Date(task.due_at);
  const after = due > now ? due : now;
  const nextDue = nextOccurrence(task.rrule, due, after);
  if (!nextDue) return { completed, next: null };

  const next = newTask({
    title: task.title,
    notes: task.notes,
    list_id: task.list_id,
    due_at: nextDue.toISOString(),
    all_day: task.all_day,
    // Only written when set, so the row stays valid on a database that predates migration 0005.
    ...(task.duration_minutes != null ? { duration_minutes: task.duration_minutes } : {}),
    ...carryReminders(task),
    rrule: task.rrule,
    starred: task.starred,
    flagged: task.flagged,
  });
  return { completed, next };
}

/**
 * Check or uncheck a task. `save` reports whether the write worked; the first failed write stops everything after it,
 * so a failed save never spawns the next occurrence of a repeating task and never announces success.
 */
export async function toggleTaskComplete(
  task: Task,
  save: (t: Task) => Promise<boolean>,
  notify: (message: string) => void,
  now = new Date(),
): Promise<boolean> {
  if (task.completed_at) return save({ ...task, completed_at: null, updated_at: now.toISOString() });
  const { completed, next } = completeTask(task, now);
  if (!(await save(completed))) return false;
  if (next) {
    if (!(await save(next))) return false;
    notify("Done. Next one is on the list.");
  }
  return true;
}

export function listFor(lists: List[], id: string | null): List | undefined {
  return id ? lists.find((l) => l.id === id) : undefined;
}

export function isOverdue(t: Task, now = new Date()): boolean {
  if (t.completed_at || !t.due_at) return false;
  const due = new Date(t.due_at);
  if (t.all_day) return +due < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return +due < +now;
}

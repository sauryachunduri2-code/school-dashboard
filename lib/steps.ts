import { uid } from "./dates";
import type { Task, TaskStep } from "./types";

/** A task's checklist; rows saved before migration 0007 have none. */
export const stepsOf = (t: Pick<Task, "steps">): TaskStep[] => (Array.isArray(t.steps) ? t.steps : []);

export const newStep = (title: string): TaskStep => ({ id: uid(), title: title.trim(), done: false });

export function stepProgress(t: Pick<Task, "steps">): { done: number; total: number } {
  const steps = stepsOf(t);
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

/** The first step not done yet: the one to work on. */
export const currentStep = (t: Pick<Task, "steps">): TaskStep | null => stepsOf(t).find((s) => !s.done) ?? null;

export const toggleStep = (steps: TaskStep[], id: string): TaskStep[] => steps.map((s) => (s.id === id ? { ...s, done: !s.done } : s));

export const renameStep = (steps: TaskStep[], id: string, title: string): TaskStep[] =>
  steps.map((s) => (s.id === id ? { ...s, title } : s));

export const removeStep = (steps: TaskStep[], id: string): TaskStep[] => steps.filter((s) => s.id !== id);

/** Move a step up (-1) or down (+1); out-of-range moves are ignored. */
export function moveStep(steps: TaskStep[], id: string, by: -1 | 1): TaskStep[] {
  const i = steps.findIndex((s) => s.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= steps.length) return steps;
  const out = steps.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

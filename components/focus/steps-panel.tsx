"use client";

import { useState } from "react";
import { IconX } from "@/components/icons";
import { TaskCheck } from "@/components/task-row";
import { currentStep, newStep, removeStep, stepProgress, stepsOf, toggleStep } from "@/lib/steps";
import type { Task, TaskStep } from "@/lib/types";

/** The task's checklist: tick steps live, the first open one is highlighted, add more inline. Falls back to the notes. */
export function StepsPanel({ task, onChange }: { task: Task; onChange: (steps: TaskStep[]) => void }) {
  const [draft, setDraft] = useState("");
  const steps = stepsOf(task);
  const current = currentStep(task);
  const { done, total } = stepProgress(task);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    onChange([...steps, newStep(title)]);
    setDraft("");
  }

  return (
    <section aria-label="Steps" className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="display text-base">Steps</h2>
        {total > 0 && (
          <span className="num text-xs text-ink3" aria-label={`${done} of ${total} done`}>
            {done}/{total}
          </span>
        )}
      </div>

      {total > 0 ? (
        <ul className="grid gap-0.5">
          {steps.map((s) => {
            const isCurrent = current?.id === s.id;
            return (
              <li
                key={s.id}
                className={`group flex items-start gap-3 rounded-md py-1.5 pl-3 pr-1.5 transition-colors ${isCurrent ? "bg-sheet2" : ""}`}
                style={isCurrent ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}
                aria-current={isCurrent ? "step" : undefined}
              >
                <TaskCheck done={s.done} label={`${s.done ? "Uncheck" : "Check"} ${s.title}`} onToggle={() => onChange(toggleStep(steps, s.id))} className="mt-0.5" />
                <span className={`min-w-0 flex-1 break-words text-[0.95rem] leading-snug ${s.done ? "text-ink3 line-through decoration-ink3/50" : isCurrent ? "font-medium" : "text-ink2"}`}>{s.title}</span>
                <button
                  type="button"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink3 opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-60"
                  aria-label={`Remove step ${s.title}`}
                  onClick={() => onChange(removeStep(steps, s.id))}
                >
                  <IconX width={13} height={13} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : task.notes.trim() ? (
        <p className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-sheet2/60 px-3 py-2 text-sm leading-relaxed text-ink2">{task.notes}</p>
      ) : (
        <p className="text-sm text-ink3">No steps yet. Break it into small pieces and the first one will light up.</p>
      )}

      {total > 0 && !current && <p className="mt-2 px-3 text-sm text-ink2">Every step is checked. Hit Done when you&apos;re ready.</p>}

      <form onSubmit={add} className="mt-3">
        <label className="sr-only" htmlFor="focus-add-step">
          Add a step
        </label>
        <input id="focus-add-step" className="field" placeholder={total ? "Add a step" : "Add a first step"} value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
      </form>

      {total > 0 && task.notes.trim() && (
        <details className="mt-3 text-sm text-ink2">
          <summary className="cursor-pointer select-none text-ink3 hover:text-ink">Notes</summary>
          <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">{task.notes}</p>
        </details>
      )}
    </section>
  );
}

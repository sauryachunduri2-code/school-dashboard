"use client";

import { useMemo, useState } from "react";
import { inboxTasks } from "@/lib/braindump";
import { addDays, startOfDay } from "@/lib/dates";
import { useLists, useTaskActions, useTasks } from "@/lib/hooks";
import { AREAS, type Task } from "@/lib/types";
import { useUi } from "@/lib/ui";
import { TaskCheck } from "./task-row";

/**
 * Holding pen for half-formed items: open tasks with no list and no date (what a plain quick-add makes).
 * Giving one a list or a date files it away, so it leaves. Hidden when there's nothing to triage.
 */
export function Inbox({ className = "" }: { className?: string }) {
  const tasks = useTasks();
  const lists = useLists();
  const actions = useTaskActions();
  const { openEditor } = useUi();
  const [open, setOpen] = useState(true);
  const items = useMemo(() => inboxTasks(tasks), [tasks]);
  if (items.length === 0) return null;

  const dueOn = (t: Task, days: number) =>
    actions.update(t, {
      due_at: addDays(startOfDay(new Date()), days).toISOString(),
      all_day: true,
    });
  const chip =
    "rounded-full border border-rule-strong px-2.5 py-1 text-xs text-ink2 hover:bg-sheet2";

  return (
    <section aria-labelledby="inbox-title" className={className}>
      <h2 id="inbox-title" className="display text-base">
        <button
          type="button"
          aria-expanded={open}
          className="flex min-h-8 items-center gap-1.5"
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden className="text-xs text-ink3">
            {open ? "▾" : "▸"}
          </span>
          Inbox <span className="num text-sm text-ink3">({items.length})</span>
        </button>
      </h2>
      {open && (
        <ul className="grid">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-rule py-1.5 first:border-t-0"
            >
              <TaskCheck
                done={false}
                label={`Complete ${t.title}`}
                onToggle={() => void actions.toggleComplete(t)}
              />
              <button
                type="button"
                className="min-w-0 flex-1 basis-40 truncate text-left text-sm"
                onClick={() => openEditor({ kind: "task", task: t })}
              >
                {t.title}
              </button>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-[1.95rem] sm:pl-0">
                <select
                  aria-label={`List for ${t.title}`}
                  className="h-7 max-w-32 rounded-full border border-rule-strong bg-paper px-2 text-xs text-ink2"
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    void actions.update(t, { list_id: e.target.value })
                  }
                >
                  <option value="">List…</option>
                  {AREAS.map((a) => {
                    const inArea = lists.filter((l) => l.area === a.id);
                    return (
                      inArea.length > 0 && (
                        <optgroup key={a.id} label={a.label}>
                          {inArea.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </optgroup>
                      )
                    );
                  })}
                </select>
                <button
                  type="button"
                  className={chip}
                  onClick={() => void dueOn(t, 0)}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={chip}
                  onClick={() => void dueOn(t, 1)}
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  className={chip}
                  onClick={() => openEditor({ kind: "task", task: t })}
                >
                  Pick…
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import { memo } from "react";
import type { AgendaItem } from "@/lib/agenda";
import { formatTime } from "@/lib/dates";
import { describeRrule } from "@/lib/recurrence";
import { stepProgress } from "@/lib/steps";
import { useTaskActions } from "@/lib/hooks";
import type { List, Task } from "@/lib/types";
import { useUi } from "@/lib/ui";
import { InkCheck, IconFlag, IconRepeat, IconStar } from "./icons";
import { ListTag } from "./bits";

export function TaskCheck({ done, onToggle, label, className = "" }: { done: boolean; onToggle: () => void; label: string; className?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={label} className={`check ${className}`} onClick={onToggle}>
      <InkCheck />
    </button>
  );
}

/** "2/5" checklist progress next to a task's title; nothing when the task has no steps. */
export function StepBadge({ task, className = "" }: { task: Task; className?: string }) {
  const { done, total } = stepProgress(task);
  if (!total) return null;
  const all = done === total;
  return (
    <span className={`num shrink-0 text-xs ${all ? "text-accent" : "text-ink3"} ${className}`} aria-label={`${done} of ${total} steps done`}>
      {all && <span aria-hidden>{"\u2713 "}</span>}
      {done}/{total}
    </span>
  );
}

/** Opens the Focus page on a task. Shows on row hover/focus on desktop, always on touch (needs a `group` parent). */
export function FocusLink({ task }: { task: Task }) {
  return (
    <Link
      href={`/focus?task=${encodeURIComponent(task.id)}`}
      aria-label={`Focus on ${task.title}`}
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-ink3 hover:text-ink focus-visible:text-ink md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:focus-visible:opacity-100 pointer-coarse:opacity-100"
    >
      <svg aria-hidden width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      Focus
    </Link>
  );
}

/** One row on the ruled page. The time sits left of the margin line, like a planner. */
export const AgendaRow = memo(function AgendaRow({
  item,
  list,
  showTime = true,
  overdue,
}: {
  item: AgendaItem;
  list?: List;
  showTime?: boolean;
  overdue?: boolean;
}) {
  const { openEditor } = useUi();
  const actions = useTaskActions();
  const open = () => {
    if (item.task) openEditor({ kind: "task", task: item.task });
    else if (item.event) openEditor({ kind: "event", event: item.event });
  };
  const timeLabel = !item.allDay ? formatTime(item.at) : "";
  return (
    <div className="group flex min-h-[44px] items-center">
      <div className="num w-[4.75rem] shrink-0 pr-3 text-right text-xs text-ink3">{showTime ? timeLabel : ""}</div>
      <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-3">
        {item.kind === "task" ? (
          <TaskCheck done={item.done} label={`Complete ${item.title}`} onToggle={() => actions.toggleComplete(item.task!)} />
        ) : (
          <span aria-hidden className="mx-[0.3rem] h-4 w-[3px] shrink-0 rounded-full" style={{ background: list?.color ?? "var(--ink-3)" }} />
        )}
        <button type="button" onClick={open} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
          <span className={`truncate ${item.done ? "text-ink3 line-through" : ""} ${overdue ? "text-ink" : ""}`}>{item.title}</span>
          {item.task?.rrule && <IconRepeat width={13} height={13} className="shrink-0 self-center text-ink3" aria-label={describeRrule(item.task.rrule)} />}
          {item.task && <StepBadge task={item.task} className="self-center" />}
          <span className="hidden shrink-0 sm:inline">
            <ListTag list={list} />
          </span>
        </button>
        {item.task && !item.done && <FocusLink task={item.task} />}
        {item.starred && <IconStar filled width={14} height={14} style={{ color: "var(--margin)" }} aria-label="Countdown" />}
        {item.flagged && <IconFlag filled width={14} height={14} className="text-overdue" aria-label="Flagged" />}
      </div>
    </div>
  );
});

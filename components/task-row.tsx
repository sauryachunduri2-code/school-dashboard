"use client";

import { memo } from "react";
import type { AgendaItem } from "@/lib/agenda";
import { formatTime } from "@/lib/dates";
import { describeRrule } from "@/lib/recurrence";
import { useTaskActions } from "@/lib/hooks";
import type { List } from "@/lib/types";
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
          <span className="hidden shrink-0 sm:inline">
            <ListTag list={list} />
          </span>
        </button>
        {item.starred && <IconStar filled width={14} height={14} style={{ color: "var(--margin)" }} aria-label="Countdown" />}
        {item.flagged && <IconFlag filled width={14} height={14} className="text-overdue" aria-label="Flagged" />}
      </div>
    </div>
  );
});

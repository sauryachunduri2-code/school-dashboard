"use client";

import { ListDot } from "@/components/bits";
import { IconCalendar } from "@/components/icons";
import { formatTime } from "@/lib/dates";
import { estimateMinutes } from "@/lib/focus";
import type { TodoItem } from "@/lib/insights";
import { formatTakes, itemColor, takesMinutes } from "@/lib/timeline";
import type { CalendarRow, GEvent, List, Task } from "@/lib/types";

const Heading = ({ children }: { children: React.ReactNode }) => <h2 className="display mb-2 text-base">{children}</h2>;

/** "HOSA call in 38 min": an event starting within the hour. Stronger in the last quarter hour. */
export function EventWarning({ event, minutes }: { event: GEvent; minutes: number }) {
  const soon = minutes <= 15;
  return (
    <p
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${soon ? "focus-keep font-medium" : "focus-aux"}`}
      style={{ background: "color-mix(in oklab, var(--margin) 14%, transparent)", color: "var(--ink)" }}
    >
      <IconCalendar width={16} height={16} />
      <span className="min-w-0 truncate">{event.summary}</span>
      <span className="num ml-auto shrink-0 text-ink2">in {minutes} min</span>
    </p>
  );
}

/** The next few things on today's list, each with its estimate. A task can be started right from here. */
export function UpNext({ items, lists, calendars, onPick }: { items: TodoItem[]; lists: List[]; calendars: CalendarRow[]; onPick: (t: Task) => void }) {
  return (
    <section aria-label="Up next" className="focus-aux min-w-0">
      <Heading>Up next</Heading>
      {items.length === 0 ? (
        <p className="text-sm text-ink3">Nothing else on today&apos;s list.</p>
      ) : (
        <ul className="grid gap-0.5">
          {items.map((i) => {
            const est = estimateMinutes(i);
            const body = (
              <>
                <span className="mt-[0.4rem]">
                  <ListDot color={itemColor(i.listId, i.event?.calendar_id ?? null, lists, calendars)} size={8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.95rem]">{i.title}</span>
                  <span className={`num block text-xs ${i.overdue ? "text-overdue" : "text-ink3"}`}>
                    {i.overdue ? "Overdue" : i.dateOnly ? "Today" : formatTime(i.at)}
                    {est ? ` · ${formatTakes(est)}` : ""}
                  </span>
                </span>
              </>
            );
            return (
              <li key={i.key}>
                {i.task ? (
                  <button type="button" className="flex w-full items-start gap-3 rounded-md px-3 py-1.5 text-left hover:bg-sheet2" onClick={() => onPick(i.task!)} aria-label={`Focus on ${i.title}`}>
                    {body}
                  </button>
                ) : (
                  <div className="flex items-start gap-3 px-3 py-1.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Before starting: today's open tasks. The highlighted one is what Start will focus on. */
export function TaskPicker({ tasks, lists, selectedId, suggestedId, onPick }: { tasks: Task[]; lists: List[]; selectedId: string | null; suggestedId: string | null; onPick: (t: Task) => void }) {
  return (
    <section aria-label="Pick a task" className="focus-aux min-w-0">
      <Heading>Today&apos;s tasks</Heading>
      {tasks.length === 0 ? (
        <p className="text-sm text-ink3">Nothing due today. You can still start a timer without a task.</p>
      ) : (
        <ul className="grid gap-0.5" role="radiogroup" aria-label="Task to focus on">
          {tasks.slice(0, 8).map((t) => {
            const on = t.id === selectedId;
            const list = lists.find((l) => l.id === t.list_id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`flex w-full items-start gap-3 rounded-md px-3 py-1.5 text-left transition-colors ${on ? "bg-sheet2" : "hover:bg-sheet2/70"}`}
                  style={on ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}
                  onClick={() => onPick(t)}
                >
                  <span className="mt-[0.4rem]">
                    <ListDot color={list?.color ?? "var(--ink-3)"} size={8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.95rem]">{t.title}</span>
                    <span className="num block text-xs text-ink3">
                      {list?.name ?? "Inbox"} · {formatTakes(takesMinutes(t))}
                      {t.id === suggestedId ? " · suggested" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

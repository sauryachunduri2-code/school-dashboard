"use client";

import { ListDot } from "@/components/bits";
import { IconCalendar } from "@/components/icons";
import { formatTime } from "@/lib/dates";
import { estimateMinutes, itemId } from "@/lib/focus";
import type { TodoItem } from "@/lib/insights";
import { formatTakes, itemColor } from "@/lib/timeline";
import type { CalendarRow, GEvent, List } from "@/lib/types";

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

/** The next few things on today's list, each with its estimate. Any of them can be started right from here. */
export function UpNext({ items, lists, calendars, onPick }: { items: TodoItem[]; lists: List[]; calendars: CalendarRow[]; onPick: (i: TodoItem) => void }) {
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
                <button type="button" className="flex w-full items-start gap-3 rounded-md px-3 py-1.5 text-left hover:bg-sheet2" onClick={() => onPick(i)} aria-label={`Focus on ${i.title}`}>
                  {body}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Before starting: today's open items (tasks and to-do events). The highlighted one is what Start will focus on. */
export function TaskPicker({ items, lists, calendars, selectedId, suggestedId, onPick }: { items: TodoItem[]; lists: List[]; calendars: CalendarRow[]; selectedId: string | null; suggestedId: string | null; onPick: (i: TodoItem) => void }) {
  return (
    <section aria-label="Pick something to focus on" className="focus-aux min-w-0">
      <Heading>Today&apos;s list</Heading>
      {items.length === 0 ? (
        <p className="text-sm text-ink3">Nothing due today. You can still start a timer without a task.</p>
      ) : (
        <ul className="grid gap-0.5" role="radiogroup" aria-label="Item to focus on">
          {items.slice(0, 8).map((i) => {
            const id = itemId(i);
            const on = id === selectedId;
            const list = lists.find((l) => l.id === i.listId);
            const est = estimateMinutes(i);
            return (
              <li key={i.key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`flex w-full items-start gap-3 rounded-md px-3 py-1.5 text-left transition-colors ${on ? "bg-sheet2" : "hover:bg-sheet2/70"}`}
                  style={on ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}
                  onClick={() => onPick(i)}
                >
                  <span className="mt-[0.4rem]">
                    <ListDot color={itemColor(i.listId, i.event?.calendar_id ?? null, lists, calendars)} size={8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.95rem]">{i.title}</span>
                    <span className="num block text-xs text-ink3">
                      {list?.name ?? (i.event ? "Calendar" : "Inbox")}
                      {est ? ` · ${formatTakes(est)}` : ""}
                      {id === suggestedId ? " · suggested" : ""}
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

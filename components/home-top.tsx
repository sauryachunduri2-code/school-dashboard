"use client";

import { useMemo } from "react";
import { format, formatTime } from "@/lib/dates";
import { checkSet } from "@/lib/event-checks";
import { useEventCheckToggle, useEventChecks, useGoogleEvents, useHours, useLists, useTaskActions, useTasks } from "@/lib/hooks";
import {
  buildTodoList,
  countdownText,
  dueSoon,
  ecHours,
  formatDelta,
  formatRelative,
  freeMinutesLeft,
  nextCountdown,
  todoProgress,
  upNext,
  type TodoItem,
} from "@/lib/insights";
import { formatTakes } from "@/lib/timeline";
import { useUi } from "@/lib/ui";
import { ListDot } from "./bits";
import { IconRepeat, IconStar, InkCheck } from "./icons";
import { TaskCheck } from "./task-row";

/** Same column split as the 7-day section below, so the to-do list sits right above the side panel. */
export const HOME_COLUMNS = "lg:grid-cols-[minmax(0,1fr)_clamp(280px,22vw,400px)]";

const Label = ({ children }: { children: React.ReactNode }) => <p className="text-[0.68rem] font-medium uppercase tracking-[0.1em] text-ink3">{children}</p>;

const R = 26;
const C = 2 * Math.PI * R;

/** Progress ring: the arc grows as items are checked. */
function Ring({ done, total, fraction }: { done: number; total: number; fraction: number }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={total ? `${done} of ${total} done` : "Nothing on today's list"} className="shrink-0 -rotate-90">
      <circle cx="32" cy="32" r={R} fill="none" stroke="var(--rule-strong)" strokeWidth="5" />
      <circle
        data-ring-arc
        className="ring-arc"
        cx="32"
        cy="32"
        r={R}
        fill="none"
        stroke={total > 0 && done === total ? "var(--ecs)" : "var(--accent)"}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - fraction)}
      />
    </svg>
  );
}

function useTodayData(now: Date) {
  const tasks = useTasks();
  const events = useGoogleEvents();
  const checks = useEventChecks();
  const checked = useMemo(() => checkSet(checks), [checks]);
  const todo = useMemo(() => buildTodoList(tasks, events, checked, now), [tasks, events, checked, now]);
  return { tasks, events, checked, todo };
}

/** The summary sheet: progress, up next + free time, due soon, and the countdown + EC hours line. */
export function Insights({ now }: { now: Date }) {
  const { tasks, events, checked, todo } = useTodayData(now);
  const lists = useLists();
  const logs = useHours();
  const { openEditor } = useUi();

  const progress = useMemo(() => todoProgress(todo), [todo]);
  const next = useMemo(() => upNext(tasks, events, checked, now), [tasks, events, checked, now]);
  const free = useMemo(() => freeMinutesLeft(tasks, events, now), [tasks, events, now]);
  const soon = useMemo(() => dueSoon(tasks, now), [tasks, now]);
  const cd = useMemo(() => nextCountdown(tasks, events, now), [tasks, events, now]);
  const ec = useMemo(() => ecHours(logs, now), [logs, now]);

  const openItem = (item: { task?: (typeof tasks)[number]; event?: (typeof events)[number] }) => {
    if (item.task) openEditor({ kind: "task", task: item.task });
    else if (item.event) openEditor({ kind: "event", event: item.event });
  };

  return (
    <section aria-labelledby="today-title" className="sheet min-w-0 px-5 py-4" data-insights>
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <h1 id="today-title" className="display text-2xl leading-none md:text-3xl">
          Today
        </h1>
        <p className="num text-sm italic text-ink3">{format(now, "EEEE, MMMM d")}</p>
      </header>

      <div className="grid gap-y-5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] [&>*+*]:sm:border-l [&>*+*]:sm:border-rule [&>*+*]:sm:pl-6 [&>*]:sm:pr-6 [&>*:last-child]:sm:pr-0">
        {/* progress */}
        <div className="flex items-center gap-4" data-insight="progress">
          <Ring {...progress} />
          <div>
            <Label>Progress</Label>
            <p className="display num mt-0.5 text-3xl leading-none" aria-live="polite">
              {progress.done}
              <span className="text-lg italic text-ink2"> of {progress.total}</span>
            </p>
            <p className="mt-1 text-sm text-ink2">{progress.total === 0 ? "Nothing to do today" : progress.done === progress.total ? "All done" : "done"}</p>
          </div>
        </div>

        {/* up next + time left */}
        <div className="min-w-0" data-insight="up-next">
          <Label>Up next</Label>
          {next ? (
            <button type="button" className="mt-0.5 block w-full min-w-0 text-left" onClick={() => openItem(next)}>
              <span className="flex items-baseline gap-2">
                {next.listId && <ListDot color={lists.find((l) => l.id === next.listId)?.color ?? "var(--ink-3)"} size={8} />}
                <span className="display truncate text-xl leading-tight">{next.title}</span>
              </span>
              <span className="num block text-sm text-ink2">
                {next.inProgress ? "now" : formatRelative(next.minutes)}
                <span className="text-ink3"> · {formatTime(next.at)}</span>
              </span>
            </button>
          ) : (
            <p className="mt-0.5 display text-xl italic text-ink2">Nothing else today</p>
          )}
          <p className="num mt-1.5 text-sm text-ink2">
            <span className="display text-lg text-ink">{free === 0 ? "No" : formatTakes(free)}</span> free left today
          </p>
        </div>

        {/* due soon */}
        <div className="min-w-0" data-insight="due-soon">
          <Label>Due soon</Label>
          <p className="mt-0.5 flex items-baseline gap-2">
            <span className="display num text-3xl leading-none">{soon.count}</span>
            <span className="text-sm text-ink2">{soon.count === 1 ? "task" : "tasks"} in the next 3 days</span>
          </p>
          {soon.tasks.length > 0 && (
            <ul className="mt-1.5 grid gap-0.5">
              {soon.tasks.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => openEditor({ kind: "task", task: t })} className="flex w-full min-w-0 items-center gap-2 text-left text-sm hover:underline">
                    <ListDot color={lists.find((l) => l.id === t.list_id)?.color ?? "var(--ink-3)"} size={7} />
                    <span className="truncate">{t.title}</span>
                    <span className="num ml-auto shrink-0 text-xs text-ink3">{format(new Date(t.due_at!), "EEE")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {soon.overdue > 0 && (
            <p className="num mt-1.5 text-sm font-medium text-overdue" data-overdue-count>
              {soon.overdue} overdue
            </p>
          )}
        </div>
      </div>

      {/* countdown + EC hours */}
      <footer className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-rule pt-3 text-sm" data-insight="footer">
        {cd ? (
          <button type="button" className="flex min-w-0 items-baseline gap-2 text-left hover:underline" onClick={() => openItem(cd.item)}>
            <IconStar filled width={13} height={13} className="shrink-0 self-center" style={{ color: "var(--margin)" }} aria-hidden />
            <span className="truncate">
              <span className="display text-base">{cd.item.title}</span> <span className="text-ink2">{countdownText(cd.days)}</span>
            </span>
          </button>
        ) : (
          <span className="text-ink3">Star a task or event to count down to it.</span>
        )}
        <span className="num text-ink2" data-ec-hours>
          <span className="display text-base text-ink">{ec.thisWeek} h</span> EC this week{" "}
          <span className={ec.delta > 0 ? "text-ecs" : ec.delta < 0 ? "text-ink3" : "text-ink3"}>
            ({formatDelta(ec.delta)}
            {ec.delta !== 0 && " h"} vs last week)
          </span>
        </span>
      </footer>
    </section>
  );
}

function timeLabel(i: TodoItem, now: Date): string {
  if (i.overdue && i.task) {
    const sameDay = +new Date(i.at.getFullYear(), i.at.getMonth(), i.at.getDate()) === +new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!sameDay) return format(i.at, "MMM d");
  }
  if (i.dateOnly) return i.event ? "all day" : "today";
  return formatTime(i.at);
}

function TodoRow({ item, now }: { item: TodoItem; now: Date }) {
  const lists = useLists();
  const { openEditor } = useUi();
  const taskActions = useTaskActions();
  const toggleEvent = useEventCheckToggle();
  const list = lists.find((l) => l.id === item.listId);
  const open = () => (item.task ? openEditor({ kind: "task", task: item.task }) : item.event && openEditor({ kind: "event", event: item.event }));
  return (
    <li className="todo-row flex min-h-10 items-center gap-2.5 border-t border-rule py-1 first:border-t-0" data-done={item.done} data-overdue={item.overdue || undefined} data-todo-key={item.key} style={{ opacity: item.done ? 0.5 : 1 }}>
      {item.task ? (
        <TaskCheck done={item.done} label={`Complete ${item.title}`} onToggle={() => void taskActions.toggleComplete(item.task!)} />
      ) : (
        <button type="button" role="checkbox" aria-checked={item.done} aria-label={`Mark ${item.title} done`} className="check is-event" onClick={() => void toggleEvent(item.event!, new Date(now))}>
          <InkCheck />
        </button>
      )}
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <ListDot color={list?.color ?? "var(--ink-3)"} size={8} />
        <span className={`todo-title truncate text-[0.95rem] ${item.overdue ? "font-medium text-overdue" : ""}`}>{item.title}</span>
        {item.task?.rrule && <IconRepeat width={12} height={12} className="shrink-0 text-ink3" aria-label="Repeats" />}
      </button>
      <span className={`num shrink-0 text-xs ${item.overdue ? "text-overdue" : "text-ink3"}`}>{timeLabel(item, now)}</span>
    </li>
  );
}

/** Today's to-do list: overdue first, then by time, date-only last. Done items stay, faded and struck through. */
export function TodoToday({ now }: { now: Date }) {
  const { todo } = useTodayData(now);
  const { done, total } = todoProgress(todo);
  return (
    <section aria-labelledby="todo-title" className="sheet flex min-w-0 flex-col px-4 py-3" data-todo-today>
      <header className="mb-1 flex items-baseline justify-between gap-3">
        <h2 id="todo-title" className="text-[0.68rem] font-medium uppercase tracking-[0.1em] text-ink3">
          To-do today
        </h2>
        {total > 0 && (
          <span className="num text-xs text-ink3" data-todo-count>
            {done}/{total}
          </span>
        )}
      </header>
      {todo.length === 0 ? (
        <p className="py-3 display text-lg italic text-ink2">Nothing on today&apos;s list.</p>
      ) : (
        <ul className="grid max-h-[min(30rem,55dvh)] overflow-y-auto pr-1">
          {todo.map((i) => (
            <TodoRow key={i.key} item={i} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function HomeTop({ now }: { now: Date }) {
  return (
    <div className={`grid items-start gap-x-8 gap-y-5 ${HOME_COLUMNS}`}>
      <Insights now={now} />
      <TodoToday now={now} />
    </div>
  );
}

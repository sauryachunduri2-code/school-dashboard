"use client";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { IconChevron, IconPlus } from "@/components/icons";
import { InkCheck } from "@/components/icons";
import { addDays, format, formatTime, isSameDay, monthGrid, startOfDay, weekDays, ymd } from "@/lib/dates";
import { useCalendars, useEventActions, useGoogleEvents, useGoogleStatus, useLists, useTaskActions, useTasks } from "@/lib/hooks";
import { newTask } from "@/lib/tasks";
import { useUi } from "@/lib/ui";
import type { GEvent } from "@/lib/types";
import { eventPatchFor, HOUR_H, minutesOfDay, moveItem, overlapsDay, placeTimed, snap, toCalItems, type CalItem, type Placed } from "./layout";

// ---------------------------------------------------------------- shared bits

const tint = (c: string) => `color-mix(in oklab, ${c} 22%, var(--sheet))`;

function useCreate() {
  const { openEditor } = useUi();
  const { data: status } = useGoogleStatus();
  const calendars = useCalendars();
  const canEvent = !!status?.connected && calendars.some((c) => c.enabled && !c.read_only);
  return (start: Date, end: Date, allDay: boolean) => {
    if (canEvent) openEditor({ kind: "event", event: null, isNew: true, draft: { start: start.toISOString(), end: end.toISOString(), all_day: allDay } });
    else openEditor({ kind: "task", isNew: true, task: newTask({ title: "", due_at: start.toISOString(), all_day: allDay }) });
  };
}

function Chip({ item, compact, onOpen }: { item: CalItem; compact?: boolean; onOpen: () => void }) {
  const tasks = useTaskActions();
  return (
    <div
      className="flex min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-xs leading-5"
      style={{ background: tint(item.color), borderLeft: `3px solid ${item.color}` }}
    >
      {item.kind === "task" && (
        <button
          type="button"
          role="checkbox"
          aria-checked={item.done}
          aria-label={`Complete ${item.title}`}
          className="check !h-3.5 !w-3.5 !border-[1.2px]"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void tasks.toggleComplete(item.task!);
          }}
        >
          <InkCheck />
        </button>
      )}
      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={onOpen}>
        {!compact && !item.allDay && <span className="num mr-1 text-ink2">{formatTime(item.start)}</span>}
        {item.title}
      </button>
    </div>
  );
}

function Draggable({ id, item, children, className, style }: { id: string; item: CalItem; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: { item }, disabled: !item.draggable });
  return (
    <div
      ref={setNodeRef}
      {...(item.draggable ? listeners : {})}
      {...(item.draggable ? attributes : {})}
      role="group"
      tabIndex={-1}
      className={className}
      style={{
        ...style,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 40 : style?.zIndex,
        opacity: isDragging ? 0.85 : 1,
        boxShadow: isDragging ? "var(--shadow)" : undefined,
        cursor: item.draggable ? "grab" : "default",
        touchAction: "manipulation",
        userSelect: "none",
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- recurring scope prompt

interface PendingMove {
  event: GEvent;
  patch: ReturnType<typeof eventPatchFor>;
}

function ScopeDialog({ pending, onPick, onCancel }: { pending: PendingMove | null; onPick: (s: "this" | "all") => void; onCancel: () => void }) {
  return (
    <Dialog open={!!pending} onClose={onCancel} label="Move recurring event">
      <div className="grid gap-4 p-5">
        <h2 className="display text-xl italic">Move a repeating event</h2>
        <p className="text-sm text-ink2">“{pending?.event.summary}” repeats. Which events should move?</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" data-autofocus onClick={() => onPick("this")}>
            This event
          </button>
          <button className="btn btn-primary" onClick={() => onPick("all")}>
            All events
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- page

export function CalendarView() {
  const { calView, setCalView, calDate, setCalDate, openEditor } = useUi();
  const tasks = useTasks();
  const events = useGoogleEvents();
  const lists = useLists();
  const calendars = useCalendars();
  const taskActions = useTaskActions();
  const eventActions = useEventActions();
  const create = useCreate();
  const [pending, setPending] = useState<PendingMove | null>(null);

  const items = useMemo(() => toCalItems(tasks, events, lists, calendars), [tasks, events, lists, calendars]);

  const days = calView === "week" ? weekDays(calDate) : monthGrid(calDate);
  const title =
    calView === "month"
      ? format(calDate, "MMMM yyyy")
      : `${format(days[0], "MMM d")} – ${format(days[6], days[0].getMonth() === days[6].getMonth() ? "d" : "MMM d")}, ${format(days[6], "yyyy")}`;

  const step = (dir: 1 | -1) => {
    if (calView === "week") setCalDate(addDays(calDate, 7 * dir));
    else setCalDate(new Date(calDate.getFullYear(), calDate.getMonth() + dir, 1));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );

  function applyMove(item: CalItem, dayShift: number, minuteShift: number) {
    if (dayShift === 0 && minuteShift === 0) return;
    const r = moveItem(item, dayShift, minuteShift);
    if (item.kind === "task" && item.task) {
      // Reminder times follow the due time; exact custom reminders stay where they were set.
      void taskActions.update(item.task, { due_at: r.start.toISOString() });
    } else if (item.event && !item.readOnly) {
      const patch = eventPatchFor(item, r);
      if (item.event.recurring_event_id) setPending({ event: item.event, patch });
      else void eventActions.update(item.event, patch);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const item = e.active.data.current?.item as CalItem | undefined;
    if (!item) return;
    if (calView === "month") {
      const over = e.over?.id as string | undefined;
      if (!over?.startsWith("day:")) return;
      const target = new Date(over.slice(4) + "T00:00:00");
      const dayShift = Math.round((+startOfDay(target) - +startOfDay(item.start)) / 86400000);
      applyMove(item, dayShift, 0);
      return;
    }
    const grid = document.querySelector<HTMLElement>("[data-week-cols]");
    const colW = grid ? grid.getBoundingClientRect().width / 7 : 100;
    const dayShift = Math.round(e.delta.x / colW);
    const minuteShift = item.allDay ? 0 : snap((e.delta.y / HOUR_H) * 60);
    applyMove(item, dayShift, minuteShift);
  }

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="display mr-auto text-3xl md:text-4xl">{title}</h1>
        <div className="flex items-center gap-1">
          <button className="btn !px-2" onClick={() => step(-1)} aria-label={calView === "week" ? "Previous week" : "Previous month"}>
            <IconChevron dir="left" />
          </button>
          <button className="btn" onClick={() => setCalDate(new Date())}>
            Today
          </button>
          <button className="btn !px-2" onClick={() => step(1)} aria-label={calView === "week" ? "Next week" : "Next month"}>
            <IconChevron />
          </button>
        </div>
        <div role="radiogroup" aria-label="View" className="inline-flex overflow-hidden rounded-md border border-rulestrong text-sm">
          {(["week", "month"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={calView === v} onClick={() => setCalView(v)} className={`px-3 py-1.5 ${calView === v ? "bg-accent text-accentink" : "hover:bg-sheet2"}`}>
              {v === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            const s = new Date();
            s.setMinutes(0, 0, 0);
            s.setHours(s.getHours() + 1);
            create(s, new Date(+s + 3600000), false);
          }}
        >
          <IconPlus /> <span className="hidden sm:inline">New</span>
          <span className="sr-only sm:hidden">New</span>
        </button>
      </header>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {calView === "week" ? (
          <WeekGrid days={days} items={items} onOpen={(i) => open(i, openEditor)} onCreate={create} onResize={(i, endMin) => resize(i, endMin, eventActions, taskActions, setPending)} />
        ) : (
          <MonthGrid days={days} anchor={calDate} items={items} onOpen={(i) => open(i, openEditor)} onCreate={create} onDrill={(d) => { setCalDate(d); setCalView("week"); }} />
        )}
      </DndContext>

      <ScopeDialog
        pending={pending}
        onCancel={() => setPending(null)}
        onPick={(scope) => {
          if (pending) void eventActions.update(pending.event, pending.patch, scope);
          setPending(null);
        }}
      />
    </div>
  );
}

function open(i: CalItem, openEditor: ReturnType<typeof useUi>["openEditor"]) {
  if (i.task) openEditor({ kind: "task", task: i.task });
  else if (i.event) openEditor({ kind: "event", event: i.event });
}

function resize(
  i: CalItem,
  newEndMinutesFromStart: number,
  eventActions: ReturnType<typeof useEventActions>,
  _taskActions: ReturnType<typeof useTaskActions>,
  setPending: (p: PendingMove | null) => void,
) {
  void _taskActions;
  if (!i.event || i.readOnly) return;
  const end = new Date(+i.start + Math.max(15, newEndMinutesFromStart) * 60000);
  const patch = { start: i.start.toISOString(), end: end.toISOString(), all_day: false };
  if (i.event.recurring_event_id) setPending({ event: i.event, patch });
  else void eventActions.update(i.event, patch);
}

// ---------------------------------------------------------------- week

function WeekGrid({
  days,
  items,
  onOpen,
  onCreate,
  onResize,
}: {
  days: Date[];
  items: CalItem[];
  onOpen: (i: CalItem) => void;
  onCreate: (s: Date, e: Date, allDay: boolean) => void;
  onResize: (i: CalItem, minutesFromStart: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    // Open scrolled to the morning (or to now when viewing this week).
    const el = scroller.current;
    if (!el) return;
    const thisWeek = days.some((d) => isSameDay(d, new Date()));
    const timed = items.filter((i) => !i.allDay && days.some((d) => overlapsDay(i, d))).map((i) => minutesOfDay(i.start));
    const earliest = timed.length ? Math.min(...timed) - 60 : Infinity;
    const base = thisWeek ? minutesOfDay(new Date()) - 90 : 7 * 60 - 30;
    el.scrollTop = (Math.max(0, Math.min(base, earliest)) / 60) * HOUR_H;
    // Only re-run when the week changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [+days[0], items.length > 0]);

  const allDayItems = (d: Date) => items.filter((i) => i.allDay && overlapsDay(i, d));
  const maxAllDay = Math.max(1, ...days.map((d) => allDayItems(d).length));

  return (
    <div className="sheet overflow-hidden" style={{ border: "1px solid var(--rule)" }}>
      <div ref={scroller} className="max-h-[calc(100dvh-14rem)] overflow-auto md:max-h-[calc(100dvh-11rem)]">
        <div className="min-w-[52rem] md:min-w-0">
          <div className="sticky top-0 z-20 bg-sheet">
          {/* header */}
          <div className="grid grid-cols-[3rem_1fr] border-b border-rulestrong">
            <div />
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const today = isSameDay(d, now);
                return (
                  <div key={+d} className="border-l border-rule px-2 py-2 text-center" style={today ? { background: "var(--today-wash)" } : undefined}>
                    <div className="text-xs text-ink2">{format(d, "EEE")}</div>
                    <div className={`display num text-2xl leading-none ${today ? "" : "text-ink2"}`} style={today ? { textDecoration: "underline", textDecorationColor: "var(--margin)", textUnderlineOffset: 5, textDecorationThickness: 2 } : undefined}>
                      {format(d, "d")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* all-day */}
          <div className="grid grid-cols-[3rem_1fr] border-b border-rulestrong">
            <div className="px-1 pt-1 text-right text-[0.65rem] leading-5 text-ink3">all-day</div>
            <div className="grid grid-cols-7">
              {days.map((d) => (
                <div key={+d} className="grid content-start gap-0.5 border-l border-rule p-0.5" style={{ minHeight: `${maxAllDay * 1.45 + 0.4}rem` }}>
                  {allDayItems(d).map((i) => (
                    <Draggable key={i.key + ymd(d)} id={`${i.key}@${ymd(d)}`} item={i}>
                      <Chip item={i} onOpen={() => onOpen(i)} />
                    </Draggable>
                  ))}
                </div>
              ))}
            </div>
          </div>
          </div>
          {/* time grid */}
          <div className="relative grid grid-cols-[3rem_1fr]" style={{ height: 24 * HOUR_H }}>
            <div className="relative">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="num absolute right-1.5 -translate-y-1/2 text-[0.65rem] text-ink3" style={{ top: h * HOUR_H }}>
                  {h === 0 ? "" : format(new Date(2000, 0, 1, h), "h a").toLowerCase()}
                </div>
              ))}
            </div>
            <div className="relative grid grid-cols-7" data-week-cols>
              {days.map((d) => (
                <DayColumn key={+d} day={d} items={items} now={now} onOpen={onOpen} onCreate={onCreate} onResize={onResize} />
              ))}
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-rule" style={{ top: h * HOUR_H }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  items,
  now,
  onOpen,
  onCreate,
  onResize,
}: {
  day: Date;
  items: CalItem[];
  now: Date;
  onOpen: (i: CalItem) => void;
  onCreate: (s: Date, e: Date, allDay: boolean) => void;
  onResize: (i: CalItem, minutesFromStart: number) => void;
}) {
  const colRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);
  const placed = useMemo(() => placeTimed(items.filter((i) => overlapsDay(i, day)), day), [items, day]);
  const today = isSameDay(day, now);

  const minuteAt = (clientY: number) => {
    const r = colRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1440, ((clientY - r.top) / HOUR_H) * 60));
  };

  function onPointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    const a = Math.floor(minuteAt(e.clientY) / 30) * 30;
    let b = a + 60;
    let dragged = false;
    setDraft({ a, b });
    const move = (ev: PointerEvent) => {
      dragged = true;
      b = Math.max(a + 15, snap(minuteAt(ev.clientY)));
      setDraft({ a, b });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, a);
      const en = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, dragged ? b : a + 60);
      onCreate(s, en, false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={colRef}
      onPointerDown={onPointerDown}
      className="relative border-l border-rule"
      style={{ background: today ? "var(--today-wash)" : undefined, cursor: "cell" }}
      data-day={ymd(day)}
    >
      {draft && (
        <div className="pointer-events-none absolute inset-x-0.5 rounded-[3px] border border-dashed border-accent bg-accent/10 px-1 text-xs" style={{ top: (draft.a / 60) * HOUR_H, height: ((draft.b - draft.a) / 60) * HOUR_H }}>
          {formatTime(new Date(2000, 0, 1, 0, draft.a))} – {formatTime(new Date(2000, 0, 1, 0, draft.b))}
        </div>
      )}
      {today && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 h-px" style={{ top: (minutesOfDay(now) / 60) * HOUR_H, background: "var(--margin)" }}>
          <span className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full" style={{ background: "var(--margin)" }} />
        </div>
      )}
      {placed.map((p) => (
        <TimedBlock key={p.item.key + ymd(day)} p={p} day={day} onOpen={onOpen} onResize={onResize} />
      ))}
    </div>
  );
}

function TimedBlock({ p, day, onOpen, onResize }: { p: Placed; day: Date; onOpen: (i: CalItem) => void; onResize: (i: CalItem, minutesFromStart: number) => void }) {
  const { item } = p;
  const [extra, setExtra] = useState(0); // live resize in minutes
  const isTask = item.kind === "task";
  const height = ((p.height + extra) / 60) * HOUR_H - 2;

  function startResize(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const y0 = e.clientY;
    let delta = 0;
    const move = (ev: PointerEvent) => {
      delta = snap(((ev.clientY - y0) / HOUR_H) * 60);
      setExtra(Math.max(-(p.height - 15), delta));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setExtra(0);
      if (delta !== 0) {
        const durMin = Math.round((+item.end - +item.start) / 60000);
        onResize(item, durMin + delta);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <Draggable
      id={`${item.key}@${ymd(day)}`}
      item={item}
      className="absolute overflow-hidden rounded-[3px] text-xs"
      style={{
        top: (p.top / 60) * HOUR_H + 1,
        height: Math.max(isTask ? 22 : 18, height),
        left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
        width: `calc(${100 / p.cols}% - 3px)`,
        background: tint(item.color),
        borderLeft: `3px solid ${item.color}`,
        zIndex: 5,
      }}
    >
      {isTask ? (
        <Chip item={item} onOpen={() => onOpen(item)} />
      ) : (
        <button type="button" className="block h-full w-full px-1.5 py-0.5 text-left leading-tight" onClick={() => onOpen(item)}>
          <span className="block truncate font-medium">{item.title}</span>
          {height > 34 && (
            <span className="num block truncate text-ink2">
              {formatTime(item.start)} – {formatTime(item.end)}
            </span>
          )}
        </button>
      )}
      {!isTask && !item.readOnly && (
        <span
          role="separator"
          aria-label="Resize"
          onPointerDown={startResize}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
          style={{ background: "linear-gradient(transparent, color-mix(in oklab, var(--ink) 10%, transparent))" }}
        />
      )}
    </Draggable>
  );
}

// ---------------------------------------------------------------- month

function MonthCell({ day, anchor, items, onOpen, onCreate, onDrill }: { day: Date; anchor: Date; items: CalItem[]; onOpen: (i: CalItem) => void; onCreate: (s: Date, e: Date, allDay: boolean) => void; onDrill: (d: Date) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${ymd(day)}` });
  const inMonth = day.getMonth() === anchor.getMonth();
  const today = isSameDay(day, new Date());
  const dayItems = items
    .filter((i) => overlapsDay(i, day))
    .sort((a, b) => +b.allDay - +a.allDay || +a.start - +b.start);
  const MAX = 3;
  return (
    <div
      ref={setNodeRef}
      className="min-h-24 border-l border-t border-rule p-1 md:min-h-28"
      style={{ background: isOver ? "color-mix(in oklab, var(--accent) 12%, transparent)" : today ? "var(--today-wash)" : undefined, opacity: inMonth ? 1 : 0.55 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCreate(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0), new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1), true);
      }}
    >
      <div className="mb-0.5 flex justify-end">
        <button
          className={`display num grid h-6 min-w-6 place-items-center rounded-full px-1 text-sm ${today ? "bg-accent text-accentink" : "text-ink2"}`}
          onClick={() => onDrill(day)}
          aria-label={`Open week of ${format(day, "MMMM d")}`}
        >
          {format(day, "d")}
        </button>
      </div>
      <div className="grid gap-0.5">
        {dayItems.slice(0, MAX).map((i) => (
          <Draggable key={i.key + ymd(day)} id={`${i.key}@${ymd(day)}`} item={i}>
            <Chip item={i} compact onOpen={() => onOpen(i)} />
          </Draggable>
        ))}
        {dayItems.length > MAX && (
          <button className="px-1 text-left text-xs text-ink2 hover:text-ink" onClick={() => onDrill(day)}>
            +{dayItems.length - MAX} more
          </button>
        )}
      </div>
    </div>
  );
}

function MonthGrid({ days, anchor, items, onOpen, onCreate, onDrill }: { days: Date[]; anchor: Date; items: CalItem[]; onOpen: (i: CalItem) => void; onCreate: (s: Date, e: Date, allDay: boolean) => void; onDrill: (d: Date) => void }) {
  return (
    <div className="sheet overflow-hidden" style={{ border: "1px solid var(--rule)" }}>
      <div className="grid grid-cols-7 border-b border-rulestrong">
        {days.slice(0, 7).map((d) => (
          <div key={+d} className="px-2 py-1.5 text-center text-xs text-ink2">
            {format(d, "EEE")}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 [&>*:nth-child(7n+1)]:border-l-0">
        {days.map((d) => (
          <MonthCell key={+d} day={d} anchor={anchor} items={items} onOpen={onOpen} onCreate={onCreate} onDrill={onDrill} />
        ))}
      </div>
    </div>
  );
}

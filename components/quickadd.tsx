"use client";

import { useMemo, useRef, useState } from "react";
import { format } from "@/lib/dates";
import { describeRrule, toEventRrule } from "@/lib/recurrence";
import { parseQuickAdd, type Parsed } from "@/lib/quickadd";
import { formatTime } from "@/lib/dates";
import { newHoursLog, useCalendars, useEventActions, useGoogleStatus, useLists, useReminderSettings, useRowMutations, useTaskActions } from "@/lib/hooks";
import { DEFAULT_OFFSET_CHOICES, offsetLabel, type ReminderSettings } from "@/lib/reminders";
import { useUi } from "@/lib/ui";
import { formatTakes } from "@/lib/timeline";
import { Dialog } from "./dialog";
import { ListDot } from "./bits";
import { IconFlag, IconStar } from "./icons";

function dateChip(d: Date, allDay: boolean) {
  return allDay ? format(d, "EEE, MMM d") : `${format(d, "EEE, MMM d")} · ${formatTime(d)}`;
}

function Chips({ p, lists, settings }: { p: Parsed; lists: ReturnType<typeof useLists>; settings: ReminderSettings }) {
  if (p.kind === "empty") return null;
  const list = "listId" in p && p.listId ? lists.find((l) => l.id === p.listId) : null;
  const chips: React.ReactNode[] = [];
  chips.push(
    <span key="kind" className="chip" style={{ color: "var(--ink)", borderColor: "var(--ink-3)" }}>
      {p.kind === "task" ? "Task" : p.kind === "event" ? "Event" : "Hours"}
    </span>,
  );
  if (list)
    chips.push(
      <span key="list" className="chip">
        <ListDot color={list.color} size={8} />
        {list.name}
      </span>,
    );
  if (p.kind === "task" && p.due) chips.push(<span key="due" className="chip num">{dateChip(p.due, p.allDay)}</span>);
  if (p.kind === "event")
    chips.push(
      <span key="when" className="chip num">
        {format(p.start, "EEE, MMM d")} · {formatTime(p.start)}–{formatTime(p.end)}
      </span>,
    );
  if (p.kind === "hours") {
    chips.push(<span key="h" className="chip num">{p.hours} h</span>);
    chips.push(<span key="d" className="chip num">{format(p.date, "EEE, MMM d")}</span>);
  }
  if ((p.kind === "task" || p.kind === "event") && p.rrule) chips.push(<span key="r" className="chip">{describeRrule(p.rrule)}</span>);
  if (p.kind === "task" && p.durationMin != null)
    chips.push(
      <span key="takes" className="chip num">
        Takes {formatTakes(p.durationMin)}
        {(!p.due || p.allDay) && " (needs a time)"}
      </span>,
    );
  if (p.kind === "task" && p.due && settings.default_remind_offset != null) {
    const label = DEFAULT_OFFSET_CHOICES.find((c) => c.value === settings.default_remind_offset)?.label ?? offsetLabel(settings.default_remind_offset);
    chips.push(<span key="rem-default" className="chip">Default reminder: {label.toLowerCase()}</span>);
  }
  if (p.kind === "task")
    p.reminders.forEach((r, i) =>
      chips.push(
        <span key={`rem-${i}`} className="chip num">
          Remind {r.kind === "at" ? dateChip(new Date(r.at), false) : offsetLabel(r.minutes).toLowerCase()}
        </span>,
      ),
    );
  if (p.kind === "event" && p.remindOffset != null) chips.push(<span key="rem" className="chip num">Alert {p.remindOffset} min before</span>);
  if (p.kind !== "hours" && p.starred) chips.push(<span key="s" className="chip"><IconStar filled width={12} height={12} /> Countdown</span>);
  if (p.kind !== "hours" && p.flagged) chips.push(<span key="f" className="chip"><IconFlag filled width={12} height={12} /> Flagged</span>);
  return <div className="mt-2 flex flex-wrap gap-1.5" aria-live="polite">{chips}</div>;
}

export function QuickAdd({
  onDone,
  autoFocus,
  defaultListId = null,
  className = "",
  placeholder = "Add a task or event: “essay due fri #ap-psych remind 1h”",
}: {
  onDone?: () => void;
  autoFocus?: boolean;
  /** List used when the text has no #list */
  defaultListId?: string | null;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const lists = useLists();
  const tasks = useTaskActions();
  const events = useEventActions();
  const hours = useRowMutations("hours_logs");
  const { data: status } = useGoogleStatus();
  const calendars = useCalendars();
  const { toast } = useUi();
  const settings = useReminderSettings();
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    const p = parseQuickAdd(text, lists);
    if (defaultListId && "listId" in p && !p.listId) {
      const l = lists.find((x) => x.id === defaultListId);
      return { ...p, listId: defaultListId, listName: l?.name ?? null } as Parsed;
    }
    return p;
  }, [text, lists, defaultListId]);
  const defaultCal = calendars.find((c) => c.enabled && c.is_default && !c.read_only) ?? calendars.find((c) => c.enabled && !c.read_only);

  async function submit() {
    const p = parsed;
    if (p.kind === "empty") return;
    // A failed save has already told the user why; keep the text so they can try again, and don't announce success.
    if (p.kind === "hours") {
      if (!(await hours.upsert(newHoursLog({ date: format(p.date, "yyyy-MM-dd"), hours: p.hours, list_id: p.listId, note: p.note })))) return;
      toast(`Logged ${p.hours} h${p.listName ? ` to ${p.listName}` : ""}`);
    } else if (p.kind === "event") {
      if (status?.connected && defaultCal) {
        const ev = await events.create(defaultCal.id, {
          summary: p.title || "Untitled event",
          start: p.start.toISOString(),
          end: p.end.toISOString(),
          all_day: false,
          list_id: p.listId,
          starred: p.starred,
          flagged: p.flagged,
          reminders: p.remindOffset != null ? [p.remindOffset] : undefined,
          // Google reads UNTIL as a real instant, unlike the task-style rule the parser builds
          recurrence: p.rrule ? [toEventRrule(p.rrule)] : undefined,
        });
        if (!ev) return;
        toast(`Added to ${defaultCal.summary}`);
      } else {
        const saved = await tasks.create({ title: p.title || "Untitled", due_at: p.start.toISOString(), all_day: false, list_id: p.listId, starred: p.starred, flagged: p.flagged, rrule: p.rrule });
        if (!saved) return;
        toast("Google Calendar isn't connected, so that went in as a timed task.");
      }
    } else {
      const saved = await tasks.create({
        title: p.title || "Untitled",
        list_id: p.listId,
        due_at: p.due ? p.due.toISOString() : null,
        all_day: p.allDay,
        reminders: p.reminders,
        rrule: p.rrule,
        // Only written when set (and timed), so saving works on a database that predates migration 0005.
        ...(p.durationMin != null && p.due && !p.allDay ? { duration_minutes: p.durationMin } : {}),
        starred: p.starred,
        flagged: p.flagged,
      });
      if (!saved) return;
      toast(p.listName ? `Added to ${p.listName}` : "Task added");
    }
    setText("");
    onDone?.();
    inputRef.current?.focus();
  }

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="sr-only" htmlFor="quick-add">
        Quick add
      </label>
      <input
        id="quick-add"
        ref={inputRef}
        data-autofocus={autoFocus ? "" : undefined}
        autoFocus={autoFocus}
        className="field !min-h-11 !text-base"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
        enterKeyHint="done"
      />
      <Chips p={parsed} lists={lists} settings={settings} />
      {/* Always visible, so the syntax is there while typing. */}
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink3">
        {QUICKADD_HINTS.map(([label, example]) => (
          <div key={label} className="flex gap-1">
            <dt>{label}</dt>
            <dd className="font-mono text-ink2">{example}</dd>
          </div>
        ))}
      </dl>
    </form>
  );
}

const QUICKADD_HINTS: [string, string][] = [
  ["Task:", "essay due fri 9pm"],
  ["Event (time range):", "hosa mtg thu 3-4pm"],
  ["List:", "#ap-psych"],
  ["Reminder:", "remind 1h · remind thu 7pm"],
  ["Takes:", "takes 45m"],
  ["Repeat:", "every tue"],
  ["Countdown:", "*"],
  ["Flag:", "!"],
  ["Log hours:", "log 2h hosa poster"],
];

export function QuickAddDialog() {
  const { quickAddOpen, setQuickAddOpen } = useUi();
  return (
    <Dialog open={quickAddOpen} onClose={() => setQuickAddOpen(false)} label="Quick add" top>
      <div className="p-4">
        <h2 className="display mb-3 text-xl italic">Add</h2>
        <QuickAdd autoFocus onDone={() => setQuickAddOpen(false)} />
        <p className="mt-4 text-xs text-ink3">Press Enter to add. Esc to close.</p>
      </div>
    </Dialog>
  );
}

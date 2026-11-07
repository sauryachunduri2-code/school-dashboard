"use client";

import { useMemo, useState } from "react";
import { format, parseYmd, ymd } from "@/lib/dates";
import { eventRange, exclusiveEndYmd, inclusiveLastDay } from "@/lib/agenda";
import {
  useCalendars,
  useEventActions,
  useGoogleStatus,
  useLists,
  useReminderSettings,
  useTaskActions,
  type SeriesScope,
} from "@/lib/hooks";
import { alertChoiceOf, alertPatch, type AlertChoice } from "@/lib/google/mapping";
import { buildRrule, describeRrule, parseRepeat, type Repeat } from "@/lib/recurrence";
import { CUSTOM_OFFSET_CHOICES, offsetLabel, sanitizeReminders } from "@/lib/reminders";
import { DEFAULT_TAKES, formatTakes } from "@/lib/timeline";
import type { CalendarRow, GEvent, List, Task, TaskReminder } from "@/lib/types";
import { useUi, type EditorTarget } from "@/lib/ui";
import { ListSelect, StarFlag } from "./bits";
import { Dialog } from "./dialog";
import { ReminderPicker } from "./reminder-picker";
import { IconTrash } from "./icons";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const hhmm = (d: Date) => format(d, "HH:mm");
const combine = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

const TAKES_PRESETS = [15, 30, 45, 60, 120];

/** How long a timed task takes: preset chips plus a custom number of minutes. null = the 30 minute default. */
function TakesPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const custom = value != null && !TAKES_PRESETS.includes(value);
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Takes">
        {TAKES_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={value === m}
            onClick={() => onChange(value === m ? null : m)}
            className={`num h-8 rounded-full border px-3 text-sm ${value === m ? "border-transparent bg-accent text-accentink" : "border-rulestrong hover:bg-sheet2"}`}
          >
            {formatTakes(m)}
          </button>
        ))}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={1440}
          step={5}
          aria-label="Custom minutes"
          placeholder="Custom min"
          className={`field num !h-8 !min-h-0 !w-28 !rounded-full !px-3 !py-0 text-sm ${custom ? "!border-accent" : ""}`}
          value={custom ? value : ""}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            onChange(e.target.value === "" || !(n >= 1) ? null : Math.min(1440, n));
          }}
        />
      </div>
      <p className="text-xs text-ink3">{value == null ? `Default: ${DEFAULT_TAKES}m.` : `Blocks ${formatTakes(value)} ending at the due time.`}</p>
    </div>
  );
}

function RepeatPicker({ value, onChange, disabled }: { value: Repeat | null; onChange: (r: Repeat | null) => void; disabled?: boolean }) {
  const freq = value?.freq ?? "none";
  return (
    <div className="grid gap-2">
      <select
        className="field"
        value={freq}
        disabled={disabled}
        aria-label="Repeat"
        onChange={(e) => {
          const f = e.target.value;
          if (f === "none") onChange(null);
          else if (f === "daily") onChange({ freq: "daily", until: value?.until ?? null });
          else if (f === "monthly") onChange({ freq: "monthly", until: value?.until ?? null });
          else onChange({ freq: "weekly", days: value?.freq === "weekly" ? value.days : [], until: value?.until ?? null });
        }}
      >
        <option value="none">Does not repeat</option>
        <option value="daily">Every day</option>
        <option value="weekly">Every week</option>
        <option value="monthly">Every month</option>
      </select>
      {value?.freq === "weekly" && (
        <div className="flex gap-1" role="group" aria-label="Repeat on">
          {DAYS.map((d, i) => {
            const on = value.days.includes(i);
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                aria-label={DAY_LABELS[i]}
                disabled={disabled}
                onClick={() => onChange({ ...value, days: on ? value.days.filter((x) => x !== i) : [...value.days, i] })}
                className={`h-8 w-8 rounded-full border text-sm ${on ? "border-transparent bg-accent text-accentink" : "border-rulestrong hover:bg-sheet2"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      )}
      {value && (
        <label className="flex items-center gap-2 text-sm text-ink2">
          Ends
          <input
            type="date"
            className="field !w-auto"
            disabled={disabled}
            value={value.until ? ymd(value.until) : ""}
            onChange={(e) => onChange({ ...value, until: e.target.value ? parseYmd(e.target.value) : null })}
          />
          <span className="text-xs text-ink3">{value.until ? "" : "Never"}</span>
        </label>
      )}
    </div>
  );
}

export function EditorDialog() {
  const { editor, openEditor } = useUi();
  const close = () => openEditor(null);
  return (
    <Dialog open={!!editor} onClose={close} label={editor?.kind === "event" ? "Event" : "Task"} wide>
      {editor && <EditorBody key={editorKey(editor)} target={editor} onClose={close} />}
    </Dialog>
  );
}

const editorKey = (t: EditorTarget) => (t.kind === "task" ? `t:${t.task.id}` : `e:${t.event?.id ?? JSON.stringify(t.draft)}`);

function EditorBody({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const lists = useLists();
  const calendars = useCalendars();
  const { data: status } = useGoogleStatus();
  const writable = calendars.filter((c) => c.enabled && !c.read_only);
  const canEvent = !!status?.connected && writable.length > 0;

  const isNew = target.isNew ?? false;
  const [kind, setKind] = useState<"task" | "event">(target.kind);

  return (
    <div className="p-4 md:p-5">
      {isNew && canEvent && (
        <div role="radiogroup" aria-label="Type" className="mb-4 inline-flex overflow-hidden rounded-md border border-rulestrong">
          {(["task", "event"] as const).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`px-4 py-1.5 text-sm ${kind === k ? "bg-accent text-accentink" : "hover:bg-sheet2"}`}
            >
              {k === "task" ? "Task" : "Event"}
            </button>
          ))}
        </div>
      )}
      {kind === "task" ? (
        <TaskForm target={target} lists={lists} isNew={isNew} onClose={onClose} />
      ) : (
        <EventForm target={target} lists={lists} calendars={writable} allCalendars={calendars} isNew={isNew} onClose={onClose} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ task

function TaskForm({ target, lists, isNew, onClose }: { target: EditorTarget; lists: List[]; isNew: boolean; onClose: () => void }) {
  const actions = useTaskActions();
  const seed: Task | null = target.kind === "task" ? target.task : null;
  const seedDraft = target.kind === "event" ? target.draft : undefined;

  const initialDue = seed?.due_at ? new Date(seed.due_at) : seedDraft ? new Date(seedDraft.start) : null;
  const [title, setTitle] = useState(seed?.title ?? "");
  const [notes, setNotes] = useState(seed?.notes ?? "");
  const [listId, setListId] = useState<string | null>(seed?.list_id ?? null);
  const [date, setDate] = useState(initialDue ? ymd(initialDue) : "");
  const [allDay, setAllDay] = useState(seed ? seed.all_day || !seed.due_at : (seedDraft?.all_day ?? true));
  const [time, setTime] = useState(initialDue && !(seed?.all_day ?? seedDraft?.all_day) ? hhmm(initialDue) : "09:00");
  const [repeat, setRepeat] = useState<Repeat | null>(parseRepeat(seed?.rrule ?? null));
  const [takes, setTakes] = useState<number | null>(seed?.duration_minutes ?? null);
  const settings = useReminderSettings();
  const [remindDefault, setRemindDefault] = useState(seed?.remind_default ?? true);
  const [reminders, setReminders] = useState<TaskReminder[]>(() => sanitizeReminders(seed?.reminders));
  const [starred, setStarred] = useState(seed?.starred ?? false);
  const [flagged, setFlagged] = useState(seed?.flagged ?? false);

  const due = useMemo(() => {
    if (!date) return null;
    return allDay ? combine(date, "00:00") : combine(date, time);
  }, [date, time, allDay]);

  async function save() {
    if (!title.trim()) return;
    const patch: Partial<Task> = {
      title: title.trim(),
      notes,
      list_id: listId,
      due_at: due ? due.toISOString() : null,
      all_day: allDay || !due,
      rrule: repeat && due ? buildRrule(repeat) : null,
      remind_default: remindDefault,
      // "Before due" reminders mean nothing without a due date; exact times are kept.
      reminders: due ? reminders : reminders.filter((r) => r.kind === "at"),
      starred,
      flagged,
    };
    // Only written when set, or to clear a stored value, so saving works on a database that predates migration 0005.
    if (due && !allDay && takes != null) patch.duration_minutes = takes;
    else if (seed?.duration_minutes !== undefined) patch.duration_minutes = null;
    if (seed && !isNew) await actions.update(seed, patch);
    else await actions.create({ ...patch, title: title.trim() });
    onClose();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="grid gap-4"
    >
      <div className="flex items-start gap-2">
        <input data-autofocus className="field !min-h-11 flex-1 !text-lg display" placeholder="Task" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <StarFlag starred={starred} flagged={flagged} onStar={() => setStarred(!starred)} onFlag={() => setFlagged(!flagged)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="List">
          <ListSelect lists={lists} value={listId} onChange={setListId} />
        </Field>
        <Field label="Due">
          <div className="flex gap-2">
            <input type="date" className="field" aria-label="Due date" value={date} onChange={(e) => setDate(e.target.value)} />
            {!allDay && <input type="time" className="field !w-32" aria-label="Due time" value={time} onChange={(e) => setTime(e.target.value)} />}
          </div>
          <label className="mt-1.5 flex items-center gap-2 text-sm text-ink2">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
          </label>
        </Field>
        <Field label="Repeat">
          <RepeatPicker value={repeat} onChange={setRepeat} disabled={!due} />
        </Field>
        {due && !allDay && (
          <Field label="Takes">
            <TakesPicker value={takes} onChange={setTakes} />
          </Field>
        )}
      </div>

      <Field label="Reminders (push)">
        <ReminderPicker due={due} allDay={allDay} settings={settings} remindDefault={remindDefault} onRemindDefault={setRemindDefault} reminders={reminders} onReminders={setReminders} />
      </Field>

      <Field label="Notes">
        <textarea className="field min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="flex items-center justify-between gap-2">
        {seed && !isNew ? (
          <button
            type="button"
            className="btn btn-ghost text-overdue"
            onClick={async () => {
              await actions.remove(seed.id);
              onClose();
            }}
          >
            <IconTrash /> Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
            {isNew ? "Add task" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ event

function EventForm({
  target,
  lists,
  calendars,
  allCalendars,
  isNew,
  onClose,
}: {
  target: EditorTarget;
  lists: List[];
  calendars: CalendarRow[];
  allCalendars: CalendarRow[];
  isNew: boolean;
  onClose: () => void;
}) {
  const actions = useEventActions();
  const seed: GEvent | null = target.kind === "event" ? target.event : null;
  const draft = target.kind === "event" ? target.draft : undefined;
  const range = seed ? eventRange(seed) : draft ? { start: new Date(draft.start), end: new Date(draft.end) } : { start: new Date(), end: new Date() };
  const readOnly = !!seed?.read_only;

  const defaultCal = calendars.find((c) => c.is_default) ?? calendars[0];
  const [calendarId, setCalendarId] = useState(seed?.calendar_id ?? draft?.calendar_id ?? defaultCal?.id ?? "");
  const [title, setTitle] = useState(seed?.summary ?? (target.kind === "task" ? target.task.title : ""));
  const [description, setDescription] = useState(seed?.description ?? "");
  const [listId, setListId] = useState<string | null>(seed?.list_id ?? (target.kind === "task" ? target.task.list_id : null));
  const [allDay, setAllDay] = useState(seed?.all_day ?? draft?.all_day ?? false);
  const [startDate, setStartDate] = useState(ymd(range.start));
  // Google's all-day end is exclusive (drafts too); the form always shows the inclusive last day and save() converts back.
  const [endDate, setEndDate] = useState(ymd(allDay ? inclusiveLastDay(range.start, range.end) : range.end));
  const [startTime, setStartTime] = useState(hhmm(range.start));
  const [endTime, setEndTime] = useState(hhmm(range.end));
  const initialAlert = alertChoiceOf(seed);
  const [alert, setAlert] = useState<AlertChoice>(initialAlert);
  const [todo, setTodo] = useState(seed?.todo ?? false);
  const [starred, setStarred] = useState(seed?.starred ?? false);
  const [flagged, setFlagged] = useState(seed?.flagged ?? false);
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [scope, setScope] = useState<SeriesScope>("this");
  const isInstance = !!seed?.recurring_event_id;

  async function save() {
    if (!title.trim() || readOnly) return;
    let start: string;
    let end: string;
    if (allDay) {
      start = startDate;
      end = exclusiveEndYmd(startDate, endDate);
    } else {
      const s = combine(startDate, startTime);
      let e = combine(endDate, endTime);
      if (+e <= +s) e = new Date(+s + 3600_000);
      start = s.toISOString();
      end = e.toISOString();
    }
    const patch = {
      summary: title.trim(),
      description,
      start,
      end,
      all_day: allDay,
      list_id: listId,
      starred,
      flagged,
      // Alerts are only sent when the user changed the control, so other edits never rewrite them.
      ...alertPatch(initialAlert, alert),
      // The to-do flag of a series lives on its master; the server handles that. Only sent when it changed (or set on a new event).
      ...(isNew ? (todo ? { todo } : {}) : todo !== (seed?.todo ?? false) ? { todo } : {}),
    };
    if (seed && !isNew) {
      onClose();
      await actions.update(seed, patch, scope);
    } else {
      onClose();
      await actions.create(calendarId, { ...patch, recurrence: repeat ? [buildRrule(repeat, { target: "event", allDay })] : undefined });
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="grid gap-4"
    >
      {readOnly && (
        <p className="rounded border border-rulestrong bg-sheet2 px-3 py-2 text-sm text-ink2">
          This event is on a read-only calendar ({allCalendars.find((c) => c.id === seed?.calendar_id)?.summary ?? "shared"}), so it can&apos;t be changed here.
        </p>
      )}
      <div className="flex items-start gap-2">
        <input data-autofocus className="field !min-h-11 flex-1 !text-lg display" placeholder="Event" aria-label="Title" value={title} disabled={readOnly} onChange={(e) => setTitle(e.target.value)} />
        <StarFlag starred={starred} flagged={flagged} onStar={readOnly ? undefined : () => setStarred(!starred)} onFlag={readOnly ? undefined : () => setFlagged(!flagged)} />
      </div>

      <label
        className={`flex items-center justify-between gap-4 rounded-md border px-3 py-2.5 ${todo ? "border-accent bg-sheet2" : "border-rulestrong"} ${readOnly ? "opacity-60" : "cursor-pointer"}`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">Add to to-do list</span>
          <span className="block text-xs text-ink3">
            {readOnly
              ? "This calendar is read-only."
              : isInstance || seed?.recurrence
                ? "Appears in “To-do today” on every day this series occurs."
                : "Appears in “To-do today” on Home on the day it occurs, with its own check."}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={todo}
          aria-label="Add to to-do list"
          disabled={readOnly}
          onClick={() => setTodo(!todo)}
          className="todo-switch"
        />
      </label>

      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts">
          <div className="flex gap-2">
            <input type="date" className="field" aria-label="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            {!allDay && <input type="time" className="field !w-32" aria-label="Start time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
          </div>
        </Field>
        <Field label="Ends">
          <div className="flex gap-2">
            <input type="date" className="field" aria-label="End date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            {!allDay && <input type="time" className="field !w-32" aria-label="End time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink2 sm:col-span-2">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
        </label>
        <Field label="Calendar">
          <select className="field" value={calendarId} disabled={!isNew} onChange={(e) => setCalendarId(e.target.value)}>
            {(isNew ? calendars : allCalendars).map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
              </option>
            ))}
          </select>
        </Field>
        <Field label="List">
          <ListSelect lists={lists} value={listId} onChange={setListId} />
        </Field>
        <Field label="Alert (Google Calendar)">
          <select
            className="field"
            value={String(alert)}
            onChange={(e) => setAlert(e.target.value === "default" || e.target.value === "none" ? e.target.value : Number(e.target.value))}
          >
            <option value="default">Calendar default</option>
            <option value="none">None</option>
            {/* the event's own alert is always listed, even when it isn't one of the standard choices */}
            {[...new Set([...CUSTOM_OFFSET_CHOICES, ...(typeof alert === "number" ? [alert] : [])])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "At the time" : offsetLabel(m)}
              </option>
            ))}
          </select>
        </Field>
        {isNew ? (
          <Field label="Repeat">
            <RepeatPicker value={repeat} onChange={setRepeat} />
          </Field>
        ) : (
          seed?.recurrence && <p className="self-end text-sm text-ink2">{describeRrule(seed.recurrence[0] ?? null, "event")}</p>
        )}
      </fieldset>

      {isInstance && !readOnly && (
        <div role="radiogroup" aria-label="Apply changes to" className="flex gap-4 text-sm">
          {(["this", "all"] as const).map((s) => (
            <label key={s} className="flex items-center gap-1.5">
              <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} />
              {s === "this" ? "This event" : "All events in the series"}
            </label>
          ))}
        </div>
      )}

      <Field label="Notes">
        <textarea className="field min-h-20" value={description} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <div className="flex items-center justify-between gap-2">
        {seed && !isNew && !readOnly ? (
          <button
            type="button"
            className="btn btn-ghost text-overdue"
            onClick={async () => {
              onClose();
              await actions.remove(seed, scope);
            }}
          >
            <IconTrash /> {isInstance ? (scope === "all" ? "Delete series" : "Delete this event") : "Delete"}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button type="submit" className="btn btn-primary" disabled={!title.trim() || !calendarId}>
              {isNew ? "Add event" : "Save"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-ink2">{label}</div>
      {children}
    </div>
  );
}

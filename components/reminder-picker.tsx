"use client";

import { useState } from "react";
import { format } from "@/lib/dates";
import { CUSTOM_OFFSET_CHOICES, DEFAULT_OFFSET_CHOICES, computeRemindAt, offsetLabel, reminderBase, type ReminderSettings } from "@/lib/reminders";
import type { TaskReminder } from "@/lib/types";
import { IconX } from "./icons";

const WHEN = "EEE MMM d, h:mm a";
const localInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

const keyOf = (r: TaskReminder) => (r.kind === "offset" ? `o${r.minutes}` : `a${r.at}`);

/**
 * The reminder part of the task editor: a switch for the default reminder, plus small chips for
 * custom ones (an exact time, or "before due"), each removable, with a compact add row.
 */
export function ReminderPicker({
  due,
  allDay,
  settings,
  remindDefault,
  onRemindDefault,
  reminders,
  onReminders,
}: {
  due: Date | null;
  allDay: boolean;
  settings: ReminderSettings;
  remindDefault: boolean;
  onRemindDefault: (on: boolean) => void;
  reminders: TaskReminder[];
  onReminders: (r: TaskReminder[]) => void;
}) {
  const [mode, setMode] = useState<"at" | "offset">("at");
  const [atValue, setAtValue] = useState("");
  const [offset, setOffset] = useState(60);
  const effectiveMode = due ? mode : "at";

  const defaultOff = settings.default_remind_offset;
  const base = due ? reminderBase(due, allDay, settings) : null;
  const defaultLabel = DEFAULT_OFFSET_CHOICES.find((c) => c.value === defaultOff)?.label.toLowerCase();

  const add = (r: TaskReminder) => {
    if (!reminders.some((x) => keyOf(x) === keyOf(r))) onReminders([...reminders, r]);
  };
  const canAdd = effectiveMode === "offset" || !!atValue;

  return (
    <div className="grid gap-2">
      {due && base ? (
        <label className="flex items-start gap-2 text-sm text-ink2">
          <input type="checkbox" className="mt-1" checked={remindDefault && defaultOff != null} disabled={defaultOff == null} onChange={(e) => onRemindDefault(e.target.checked)} />
          <span>
            Default reminder
            {defaultOff == null ? (
              <span className="text-ink3"> (turned off in Settings)</span>
            ) : (
              <span className="text-ink3">
                {" "}
                · {defaultLabel ?? offsetLabel(defaultOff).toLowerCase()} · <span className="num">{format(computeRemindAt(base, defaultOff), WHEN)}</span>
              </span>
            )}
          </span>
        </label>
      ) : (
        <p className="text-sm text-ink3">Add a due date to get the default reminder. You can still set an exact time below.</p>
      )}

      {reminders.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Custom reminders">
          {reminders.map((r) => {
            const when = r.kind === "at" ? format(new Date(r.at), WHEN) : offsetLabel(r.minutes);
            const fire = r.kind === "offset" && base ? ` · ${format(computeRemindAt(base, r.minutes), WHEN)}` : "";
            return (
              <li key={keyOf(r)} className={`chip num ${r.kind === "offset" && !due ? "opacity-60" : ""}`}>
                {when}
                {fire}
                {r.kind === "offset" && !due && <span className="text-ink3">(needs a due date)</span>}
                <button type="button" className="-mr-1 grid h-5 w-5 place-items-center rounded-full hover:bg-sheet2" aria-label={`Remove reminder ${when}`} onClick={() => onReminders(reminders.filter((x) => keyOf(x) !== keyOf(r)))}>
                  <IconX width={12} height={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select className="field !w-auto" aria-label="Reminder type" value={effectiveMode} onChange={(e) => setMode(e.target.value as "at" | "offset")}>
          <option value="at">At a time</option>
          {due && <option value="offset">Before due</option>}
        </select>
        {effectiveMode === "at" ? (
          <input
            type="datetime-local"
            className="field !w-auto"
            aria-label="Reminder date and time"
            value={atValue}
            // Start on the due day so picking a time is one tap.
            onFocus={() => !atValue && due && setAtValue(localInput(due))}
            onChange={(e) => setAtValue(e.target.value)}
          />
        ) : (
          <select className="field !w-auto" aria-label="Reminder offset" value={offset} onChange={(e) => setOffset(Number(e.target.value))}>
            {CUSTOM_OFFSET_CHOICES.map((m) => (
              <option key={m} value={m}>
                {offsetLabel(m)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="btn !min-h-9"
          disabled={!canAdd}
          onClick={() => {
            if (effectiveMode === "offset") add({ kind: "offset", minutes: offset });
            else {
              const d = new Date(atValue);
              if (Number.isNaN(+d)) return;
              add({ kind: "at", at: d.toISOString() });
              setAtValue("");
            }
          }}
        >
          Add reminder
        </button>
      </div>
      {due && allDay && <p className="text-xs text-ink3">All-day tasks count from {formatAllDay(settings.allday_remind_minutes)} on the due day (change it in Settings).</p>}
    </div>
  );
}

function formatAllDay(minutes: number) {
  return format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60), "h:mm a");
}

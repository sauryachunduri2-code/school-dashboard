"use client";

import { useEffect, useState } from "react";
import { format } from "@/lib/dates";
import { describeRrule } from "@/lib/recurrence";
import { useCalendars, useLists, useTaskActions } from "@/lib/hooks";
import { itemColor, type UntimedEntry } from "@/lib/timeline";
import { useUi } from "@/lib/ui";
import { IconFlag, IconRepeat, IconStar } from "./icons";
import { TaskCheck } from "./task-row";

function useEntryActions() {
  const lists = useLists();
  const calendars = useCalendars();
  const { openEditor } = useUi();
  const actions = useTaskActions();
  return {
    colorOf: (e: UntimedEntry) => itemColor(e.item.listId, e.item.event?.calendar_id ?? null, lists, calendars),
    open: (e: UntimedEntry) => {
      if (e.item.task) openEditor({ kind: "task", task: e.item.task });
      else if (e.item.event) openEditor({ kind: "event", event: e.item.event });
    },
    toggle: (e: UntimedEntry) => e.item.task && void actions.toggleComplete(e.item.task),
  };
}

function Markers({ e }: { e: UntimedEntry }) {
  return (
    <>
      {e.item.starred && <IconStar filled width={13} height={13} className="shrink-0" style={{ color: "var(--margin)" }} aria-label="Countdown" />}
      {e.item.flagged && <IconFlag filled width={13} height={13} className="shrink-0 text-overdue" aria-label="Flagged" />}
    </>
  );
}

/** Rows of untimed items for the side panel. */
export function UntimedList({ entries }: { entries: UntimedEntry[] }) {
  const { colorOf, open, toggle } = useEntryActions();
  if (entries.length === 0) return <p className="py-1 text-sm italic text-ink3">Nothing untimed</p>;
  return (
    <ul className="grid">
      {entries.map((e) => (
        <li key={e.item.key + (e.overdue ? "o" : "")} className="flex min-h-9 items-center gap-2.5 border-t border-rule py-1 first:border-t-0">
          {e.item.kind === "task" ? (
            <TaskCheck done={e.item.done} label={`Complete ${e.item.title}`} onToggle={() => toggle(e)} />
          ) : (
            <span aria-hidden className="mx-[0.3rem] h-4 w-[3px] shrink-0 rounded-full" style={{ background: colorOf(e) }} />
          )}
          <button type="button" onClick={() => open(e)} className="flex min-w-0 flex-1 flex-col text-left">
            <span className={`truncate text-sm ${e.item.done ? "text-ink3 line-through" : ""}`}>{e.item.title}</span>
            {e.overdue && <span className="num text-[0.7rem] text-overdue">Late · due {format(e.item.at, "MMM d")}</span>}
          </button>
          {e.item.task?.rrule && <IconRepeat width={12} height={12} className="shrink-0 text-ink3" aria-label={describeRrule(e.item.task.rrule)} />}
          <Markers e={e} />
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(e) }} />
        </li>
      ))}
    </ul>
  );
}

/** Phone: one compact scrolling line of chips, pinned under the day header. */
export function UntimedStrip({ entries }: { entries: UntimedEntry[] }) {
  const { colorOf, open, toggle } = useEntryActions();
  if (entries.length === 0) return null;
  return (
    <ul className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2" aria-label="Untimed">
      {entries.map((e) => (
        <li
          key={e.item.key + (e.overdue ? "o" : "")}
          className="flex max-w-[16rem] shrink-0 items-center gap-1.5 rounded-[3px] py-0.5 pl-1.5 pr-2 text-xs"
          style={{ background: `color-mix(in oklab, ${colorOf(e)} 22%, var(--sheet))`, borderLeft: `3px solid ${colorOf(e)}` }}
        >
          {e.item.kind === "task" && (
            <TaskCheck className="!h-3.5 !w-3.5 !border-[1.2px]" done={e.item.done} label={`Complete ${e.item.title}`} onToggle={() => toggle(e)} />
          )}
          <button type="button" onClick={() => open(e)} className={`min-w-0 truncate text-left ${e.item.done ? "text-ink3 line-through" : ""} ${e.overdue ? "text-overdue" : ""}`}>
            {e.overdue && "Late: "}
            {e.item.title}
          </button>
          <Markers e={e} />
        </li>
      ))}
    </ul>
  );
}

interface RollState {
  cur: number;
  prev: number | null;
  dir: 1 | -1;
}

/**
 * The sticky "Untimed" box. When the day in view changes, the new day's items roll up into place while the old
 * ones roll away (the other way round when scrolling back up). Reduced motion gets a plain crossfade (see globals.css).
 */
export function UntimedRoll({ days, labels, active }: { days: UntimedEntry[][]; labels: string[]; active: number }) {
  const [st, setSt] = useState<RollState>({ cur: active, prev: null, dir: 1 });
  if (active !== st.cur) setSt({ cur: active, prev: st.cur, dir: active > st.cur ? 1 : -1 });

  useEffect(() => {
    if (st.prev == null) return;
    const t = setTimeout(() => setSt((s) => ({ ...s, prev: null })), 340);
    return () => clearTimeout(t);
  }, [st.prev, st.cur]);

  const up = st.dir === 1;
  const layer = (i: number, cls: string, leaving: boolean) => (
    <div key={i} className={`${cls} ${leaving ? "pointer-events-none absolute inset-x-0 top-0" : ""}`} aria-hidden={leaving || undefined} data-untimed-day={i}>
      <p className="mb-1 flex items-baseline justify-between gap-2">
        <span className="display text-base">Untimed</span>
        <span className="num text-xs text-ink3">{labels[i]}</span>
      </p>
      <UntimedList entries={days[i] ?? []} />
    </div>
  );
  return (
    <section aria-label="Untimed for the day in view" aria-live="polite" className="sheet relative px-3 py-2.5">
      {st.prev != null && layer(st.prev, up ? "roll-out-up" : "roll-out-down", true)}
      {layer(st.cur, st.prev == null ? "" : up ? "roll-in-up" : "roll-in-down", false)}
    </section>
  );
}

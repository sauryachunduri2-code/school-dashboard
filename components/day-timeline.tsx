"use client";

import { memo, type CSSProperties } from "react";
import { minutesOfDay, type Placed } from "@/components/calendar/layout";
import { eventRange } from "@/lib/agenda";
import { formatTime } from "@/lib/dates";
import { checkSet, isEventChecked } from "@/lib/event-checks";
import { useEventCheckToggle, useEventChecks, useLists, useTaskActions } from "@/lib/hooks";
import { describeRrule } from "@/lib/recurrence";
import { formatTakes, HOME_HOUR_H, takesMinutes, type DayTimeline } from "@/lib/timeline";
import { useUi } from "@/lib/ui";
import { IconFlag, IconRepeat, IconStar, InkCheck } from "./icons";

const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const px = (min: number) => (min / 60) * HOME_HOUR_H;

/** One block: fills its time vertically, list-coloured; the whole block opens the editor, the checkbox completes a task. */
const Block = memo(function Block({ p, startMin, now, day, eventChecked }: { p: Placed; startMin: number; now: Date; day: Date; eventChecked: boolean }) {
  const { openEditor } = useUi();
  const actions = useTaskActions();
  const toggleEventCheck = useEventCheckToggle();
  const lists = useLists();
  const { item } = p;
  const task = item.task;
  const listName = lists.find((l) => l.id === (task ? task.list_id : item.event?.list_id))?.name;
  const height = Math.max(px(p.height) - 2, 18);
  const compact = height < 38;
  // a calendar event on the to-do list is done for this day once checked
  const todoEvent = !!item.event?.todo;
  const done = item.done || (todoEvent && eventChecked);
  const overdue = !!task && !done && +item.end < +now;
  // events show their true times even when the block is clipped at midnight or the window start
  const range = item.event ? eventRange(item.event) : null;
  const time = task ? `due ${formatTime(item.end)}` : `${formatTime(range?.start ?? item.start)}–${formatTime(range?.end ?? item.end)}`;
  const style = {
    top: px(p.top - startMin) + 1,
    height,
    left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
    width: `calc(${100 / p.cols}% - 3px)`,
    // events with no list/calendar colour get a neutral that is visible in both themes
    "--blk": item.color === "var(--ink-3)" ? "var(--blk-neutral)" : item.color,
    opacity: done ? 0.55 : 1,
  } as CSSProperties;
  const open = () => (task ? openEditor({ kind: "task", task }) : item.event && openEditor({ kind: "event", event: item.event }));
  const flagged = task?.flagged ?? item.event?.flagged;
  const starred = task?.starred ?? item.event?.starred;
  return (
    <div className="blk @container absolute overflow-hidden rounded-[3px] text-xs leading-4" style={style} data-block={item.key}>
      <button type="button" onClick={open} aria-label={`${item.title}, ${time}`} className="absolute inset-0 z-0 cursor-pointer rounded-[3px] hover:bg-ink/5" />
      <div className={`pointer-events-none relative z-[1] flex h-full min-w-0 gap-1.5 px-1.5 ${compact ? "items-center" : "items-start py-1"}`}>
        {task && (
          <button
            type="button"
            role="checkbox"
            aria-checked={item.done}
            aria-label={`Complete ${item.title}`}
            className={`check pointer-events-auto !h-3.5 !w-3.5 !border-[1.2px] ${compact ? "" : "mt-px"}`}
            onClick={() => void actions.toggleComplete(task)}
          >
            <InkCheck />
          </button>
        )}
        {todoEvent && (
          <button
            type="button"
            role="checkbox"
            aria-checked={eventChecked}
            aria-label={`Mark ${item.title} done`}
            className={`check is-event pointer-events-auto !h-3.5 !w-3.5 !border-[1.2px] ${compact ? "" : "mt-px"}`}
            onClick={() => void toggleEventCheck(item.event!, day)}
          >
            <InkCheck />
          </button>
        )}
        <div className={`min-w-0 flex-1 ${compact ? "flex items-baseline gap-1.5" : ""}`}>
          <p className={`blk-title truncate ${done ? "line-through" : ""}`}>{item.title}</p>
          <p className={`num flex min-w-0 items-center gap-1.5 truncate text-ink2 ${overdue ? "!text-overdue" : ""} ${compact ? "shrink-0" : ""}`}>
            <span className="truncate">{time}</span>
            {task && !compact && <span className="hidden text-ink3 @[9rem]:inline">· {formatTakes(takesMinutes(task))}</span>}
            {listName && !compact && <span className="hidden truncate text-ink3 @[16rem]:inline">· {listName}</span>}
          </p>
        </div>
        {task?.rrule && !compact && <IconRepeat width={12} height={12} className="mt-0.5 shrink-0 text-ink3" aria-label={describeRrule(task.rrule)} />}
        {starred && <IconStar filled width={12} height={12} className="mt-0.5 shrink-0 self-center" style={{ color: "var(--margin)" }} aria-label="Countdown" />}
        {flagged && <IconFlag filled width={12} height={12} className="mt-0.5 shrink-0 self-center text-overdue" aria-label="Flagged" />}
      </div>
    </div>
  );
});

/** The hour-ruled body of one day: labels left, blocks fill their time, a "now" line on today. */
export function DayBody({ tl, now, isToday, bodyRef }: { tl: DayTimeline; now: Date; isToday: boolean; bodyRef?: (el: HTMLDivElement | null) => void }) {
  const height = px(tl.endMin - tl.startMin);
  const hours: number[] = [];
  for (let h = Math.ceil(tl.startMin / 60); h < 24; h++) hours.push(h);
  const nowMin = minutesOfDay(now);
  const showNow = isToday && nowMin >= tl.startMin && nowMin < tl.endMin;
  const checks = useEventChecks();
  const checked = checkSet(checks);
  return (
    <div className="day-sheet py-3" data-day-body>
      <div ref={bodyRef} className="relative" style={{ height }}>
        {hours.map((h) => (
          <div key={h} aria-hidden className="absolute inset-x-0" style={{ top: px(h * 60 - tl.startMin) }}>
            <span className="num absolute left-0 w-[2.75rem] -translate-y-1/2 pr-2 text-right text-[0.65rem] leading-none text-ink3">{hourLabel(h)}</span>
            <div className="ml-[3.25rem] border-t border-rule" />
          </div>
        ))}
        <div aria-hidden className="absolute inset-x-0 bottom-0 ml-[3.25rem] border-t border-rule" />
        <div className="absolute inset-y-0 left-[3.25rem] right-2">
          {tl.placed.map((p) => (
            <Block key={p.item.key} p={p} startMin={tl.startMin} now={now} day={tl.date} eventChecked={!!p.item.event && isEventChecked(checked, p.item.event, tl.date)} />
          ))}
        </div>
        {showNow && (
          <div aria-hidden data-now-line className="pointer-events-none absolute inset-x-0 z-10 h-px" style={{ top: px(nowMin - tl.startMin), background: "var(--margin)" }}>
            <span className="absolute -top-[3px] left-[3.25rem] h-[7px] w-[7px] -translate-x-1/2 rounded-full" style={{ background: "var(--margin)" }} />
          </div>
        )}
      </div>
    </div>
  );
}

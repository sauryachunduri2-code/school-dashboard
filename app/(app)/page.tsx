"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ListDot } from "@/components/bits";
import { DayBody } from "@/components/day-timeline";
import { HOME_COLUMNS, HomeTop } from "@/components/home-top";
import { QuickAdd } from "@/components/quickadd";
import { TaskCheck } from "@/components/task-row";
import { UntimedRoll, UntimedStrip } from "@/components/untimed";
import { addDays, dayLabel, format, startOfDay } from "@/lib/dates";
import { useCalendars, useGoogleEvents, useLists, useTaskActions, useTasks } from "@/lib/hooks";
import { buildDayTimeline, homeTimedItems, untimedByDay } from "@/lib/timeline";
import { useUi } from "@/lib/ui";

const DAYS = 7;

/** Re-render when the minute changes so "Today", the now line and overdue stay honest while the tab is open. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    const onVis = () => setNow(new Date());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return now;
}

/**
 * Which day section is under a thin band near the top of the viewport. An IntersectionObserver reports changes,
 * so state only updates when the day actually changes (not per scroll frame).
 */
function useActiveDay(count: number, resetKey: number) {
  const [active, setActive] = useState(0);
  const els = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const visible = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.dayIndex);
          if (e.isIntersecting) visible.add(i);
          else visible.delete(i);
        }
        if (visible.size) setActive(Math.min(...visible));
      },
      { rootMargin: "-10% 0px -89% 0px" },
    );
    els.current.slice(0, count).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [count, resetKey]);
  const ref = (i: number) => (el: HTMLElement | null) => {
    els.current[i] = el;
  };
  return { active, ref };
}

const SideHeading = ({ children }: { children: React.ReactNode }) => <h2 className="display mb-1 text-base">{children}</h2>;

export default function HomePage() {
  const now = useNow();
  const tasks = useTasks();
  const events = useGoogleEvents();
  const lists = useLists();
  const calendars = useCalendars();
  const actions = useTaskActions();
  const { openEditor } = useUi();

  const today = startOfDay(now);
  const todayKey = +today;
  const dates = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(new Date(todayKey), i)), [todayKey]);
  const items = useMemo(() => homeTimedItems(tasks, events, lists, calendars), [tasks, events, lists, calendars]);
  const timelines = useMemo(() => dates.map((d) => buildDayTimeline(d, items)), [dates, items]);
  const untimed = useMemo(() => untimedByDay(tasks, events, now, DAYS), [tasks, events, now]);
  const labels = useMemo(() => dates.map((d) => format(d, "EEE MMM d")), [dates]);

  const flagged = useMemo(() => tasks.filter((t) => t.flagged && !t.completed_at).sort((a, b) => (a.due_at ?? "9").localeCompare(b.due_at ?? "9")), [tasks]);
  const anytime = useMemo(() => tasks.filter((t) => !t.due_at && !t.completed_at), [tasks]);

  const { active, ref: dayRef } = useActiveDay(DAYS, todayKey);

  const rangeLabel = `${format(dates[0], "MMM d")} – ${format(dates[DAYS - 1], "MMM d")}`;

  return (
    <div>
      <QuickAdd className="mb-5" />
      <HomeTop now={now} />

      <div className={`mt-8 grid gap-x-8 gap-y-6 ${HOME_COLUMNS}`}>
        <section aria-labelledby="week-title" className="min-w-0">
          <header className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="week-title" className="display text-3xl md:text-4xl">
              Next 7 days
            </h2>
            <p className="num text-sm text-ink2">{rangeLabel}</p>
          </header>

          <div>
            {dates.map((date, i) => {
              const isToday = i === 0;
              const label = dayLabel(date, now);
              return (
                <section key={+date} ref={dayRef(i)} data-day-index={i} aria-label={`${label} ${format(date, "MMM d")}`} className="pb-6">
                  <div
                    className="sticky top-[3.4rem] z-20 -mx-4 px-4 md:top-0 md:-mx-8 md:px-8"
                    style={{ background: isToday ? "linear-gradient(to right, var(--today-wash), transparent 70%), var(--paper)" : "var(--paper)" }}
                  >
                    <h2 className="display flex items-baseline gap-2 border-b border-rule pb-1.5 pt-2 text-xl leading-none">
                      {label === "Today" || label === "Tomorrow" ? label : format(date, "EEEE")}
                      <span className="num text-sm italic text-ink3">· {labels[i]}</span>
                    </h2>
                    <div className="pt-1.5 lg:hidden">
                      <UntimedStrip entries={untimed[i]} />
                    </div>
                  </div>
                  <div className="pt-2">
                    <DayBody tl={timelines[i]} now={now} isToday={isToday} />
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        <aside className="grid content-start gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1" aria-label="Side rail">
          <div className="hidden lg:block">
            <UntimedRoll days={untimed} labels={labels} active={active} />
          </div>

          <div>
            <SideHeading>Flagged</SideHeading>
            {flagged.length === 0 ? (
              <p className="text-sm text-ink3">Nothing flagged as important.</p>
            ) : (
              <ul className="grid">
                {flagged.slice(0, 4).map((t) => (
                  <FlaggedRow key={t.id} id={t.id} />
                ))}
              </ul>
            )}
          </div>

          {anytime.length > 0 && (
            <div>
              <SideHeading>
                Anytime <span className="text-xs italic text-ink3">no date</span>
              </SideHeading>
              <ul className="grid">
                {anytime.slice(0, 5).map((t) => (
                  <li key={t.id} className="flex min-h-8 items-center gap-2.5 border-t border-rule py-0.5 first:border-t-0">
                    <TaskCheck done={false} label={`Complete ${t.title}`} onToggle={() => void actions.toggleComplete(t)} />
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => openEditor({ kind: "task", task: t })}>
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
              {anytime.length > 5 && <p className="mt-1 text-xs text-ink3">+{anytime.length - 5} more in Areas</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function FlaggedRow({ id }: { id: string }) {
  const tasks = useTasks();
  const lists = useLists();
  const { openEditor } = useUi();
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  const list = lists.find((l) => l.id === t.list_id);
  return (
    <li>
      <button className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-sheet2" onClick={() => openEditor({ kind: "task", task: t })}>
        {list ? <ListDot color={list.color} /> : <span className="w-[9px]" />}
        <span className="flex-1 truncate">{t.title}</span>
        {t.due_at && <span className="num text-xs text-ink3">{format(new Date(t.due_at), "MMM d")}</span>}
      </button>
    </li>
  );
}

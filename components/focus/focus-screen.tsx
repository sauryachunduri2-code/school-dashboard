"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ListDot } from "@/components/bits";
import { IconBell, IconBellOff, IconCoffee, IconFullscreen, IconMoon, IconPause, IconPip, IconPlay, IconPlus, IconSkip, IconX } from "@/components/icons";
import { TaskCheck } from "@/components/task-row";
import { ThemeToggle } from "@/components/theme-toggle";
import { format, formatTime, ymd } from "@/lib/dates";
import { checkSet } from "@/lib/event-checks";
import {
  actualVsEstimate,
  COUNTDOWN_PRESETS,
  elapsedMs,
  end as endSession,
  eventSoon,
  focusTotals,
  formatClock,
  formatFocused,
  formatMinutes,
  formatOver,
  formatRemaining,
  hoursForMinutes,
  isOpen,
  isPaused,
  isTimeUp,
  nextPhase,
  nextTimedEvent,
  pickableTasks,
  plannedFor,
  pomodorosInRun,
  remainingMs,
  ringFraction,
  suggestTask,
  untilEventSeconds,
  upNextItems,
} from "@/lib/focus";
import { newHoursLog, useCalendars, useEventChecks, useFocusActions, useGoogleEvents, useLists, useRowMutations, useRows, useTaskActions } from "@/lib/hooks";
import { buildTodoList } from "@/lib/insights";
import { currentStep, stepsOf, toggleStep } from "@/lib/steps";
import { formatTakes, takesMinutes } from "@/lib/timeline";
import { useUi } from "@/lib/ui";
import type { FocusMode, Task, TaskStep } from "@/lib/types";
import { MiniTimer, usePip } from "./mini-timer";
import { TimerRing, type RingTone } from "./ring";
import { EventWarning, TaskPicker, UpNext } from "./side-panels";
import { StepsPanel } from "./steps-panel";
import {
  askNotificationPermission,
  isTypingTarget,
  notificationPermission,
  notify,
  playChime,
  unlockAudio,
  useDocumentTitle,
  useFocusPrefs,
  useFullscreen,
  useNow,
  useWakeLock,
} from "./use-focus";

const MODES: { id: FocusMode; label: string }[] = [
  { id: "stopwatch", label: "Count up" },
  { id: "countdown", label: "Countdown" },
  { id: "pomodoro", label: "Pomodoro" },
  { id: "until_event", label: "Until next event" },
];

interface Summary {
  taskId: string | null;
  title: string;
  actualMin: number;
  estimateMin: number | null;
  /** Work on this task today, in minutes: what "Log hours" records. */
  todayMin: number;
  listId: string | null;
  logged: boolean;
}

const iconBtn = "btn btn-ghost !h-9 !w-9 !justify-center !px-0 text-ink2";

export function FocusScreen() {
  const router = useRouter();
  const param = useSearchParams().get("task");
  const { toast, editor, quickAddOpen, searchOpen } = useUi();
  const { update, create, toggleComplete } = useTaskActions();
  const actions = useFocusActions();
  const hours = useRowMutations("hours_logs");

  const { data: taskRows } = useRows("tasks");
  const tasks = useMemo(() => taskRows ?? [], [taskRows]);
  const lists = useLists();
  const calendars = useCalendars();
  const events = useGoogleEvents();
  const checks = useEventChecks();
  const sessionsQ = useRows("focus_sessions");
  const sessions = useMemo(() => sessionsQ.data ?? [], [sessionsQ.data]);
  const qc = useQueryClient();

  const [prefs, setPrefs] = useFocusPrefs();
  const [picked, setPicked] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dismissedSwitch, setDismissedSwitch] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [pomoOpen, setPomoOpen] = useState(false);
  const [park, setPark] = useState("");
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [perm, setPerm] = useState(() => notificationPermission());
  const [, setWake] = useState(0);

  const open = useMemo(() => sessions.find(isOpen), [sessions]);
  const paused = !!open && isPaused(open);
  const running = !!open && !paused;
  const pip = usePip();
  const fs = useFullscreen();
  const nowMs = useNow(running, open ? +new Date(open.started_at) + open.paused_ms : 0, pip.win);

  // ---------------------------------------------------------------- what's on today
  const minute = Math.floor(nowMs / 60_000);
  const checked = useMemo(() => checkSet(checks), [checks]);
  const todo = useMemo(() => buildTodoList(tasks, events, checked, new Date(minute * 60_000)), [tasks, events, checked, minute]);
  const suggestion = useMemo(() => suggestTask(tasks, todo, minute * 60_000), [tasks, todo, minute]);
  const pickable = useMemo(() => pickableTasks(todo), [todo]);

  const wantedId = picked ?? param;
  const wanted = wantedId ? tasks.find((t) => t.id === wantedId) : undefined;
  const taskId = open ? open.task_id : (wanted?.id ?? suggestion?.id ?? null);
  const task = taskId ? (tasks.find((t) => t.id === taskId) ?? null) : null;
  const list = task ? lists.find((l) => l.id === task.list_id) : undefined;
  const step = task ? currentStep(task) : null;

  const soon = useMemo(() => eventSoon(events, minute * 60_000, 60), [events, minute]);
  const nextEvent = useMemo(() => nextTimedEvent(events, nowMs), [events, nowMs]);
  const untilSeconds = untilEventSeconds(events, nowMs);
  const upNext = useMemo(() => upNextItems(todo, taskId, 3), [todo, taskId]);
  const totals = focusTotals(sessions, nowMs);
  const inRun = pomodorosInRun(sessions, prefs.pomodoro, nowMs);

  // A "Focus" link to another task while a session is open: offer the switch instead of silently ignoring it.
  const conflict = open && param && !picked && param !== open.task_id && !dismissedSwitch ? tasks.find((t) => t.id === param) : undefined;

  // ---------------------------------------------------------------- timer numbers
  const timeUp = !!open && isTimeUp(open, nowMs);
  const rem = open ? remainingMs(open, nowMs) : null;
  const over = rem != null && rem < 0 ? -rem : 0;
  const isBreak = open?.kind === "break";
  const ready = !open && !summary;
  const plan = plannedFor(prefs, task, untilSeconds);
  const time = open
    ? rem == null
      ? formatClock(elapsedMs(open, nowMs))
      : formatRemaining(Math.max(0, rem))
    : plan.seconds
      ? formatClock(plan.seconds * 1000)
      : "00:00";
  const tone: RingTone = !open ? "idle" : isBreak ? "break" : timeUp ? "over" : "work";
  const heading = task?.title ?? "Free focus";

  // ---------------------------------------------------------------- chime + notification, once per timer end
  const fired = useRef<string | null>(null);
  const armed = useRef<string | null>(null);
  const L = useRef({ prefs, isBreak, heading });
  useEffect(() => {
    L.current = { prefs, isBreak, heading };
  });
  useEffect(() => {
    if (!open || !running || open.planned_seconds == null) return;
    const key = `${open.id}:${open.planned_seconds}`;
    const r = remainingMs(open, nowMs) ?? 1;
    if (r > 0) {
      armed.current = key;
      // A tab hidden behind other windows may not tick for a while: wake exactly at the end.
      const t = window.setTimeout(() => setWake((n) => n + 1), r + 40);
      return () => window.clearTimeout(t);
    }
    if (fired.current === key) return;
    fired.current = key;
    // Already over when the page opened (reload, another device): stay quiet.
    if (armed.current !== key) return;
    setAnnouncement(L.current.isBreak ? "Break is over." : "Time is up.");
    if (L.current.prefs.alerts) {
      playChime();
      notify(L.current.isBreak ? "Break's over" : "Time's up", L.current.heading);
    }
  }, [open, running, nowMs]);

  // ---------------------------------------------------------------- environment
  useWakeLock(running);
  useDocumentTitle(open ? `${paused ? "⏸ " : ""}${time}${isBreak ? " · Break" : ""} · ${task?.title ?? "Focus"}` : null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  // Another device may have started or ended a session: look again now and then.
  useEffect(() => {
    if (busy) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void qc.invalidateQueries({ queryKey: ["focus_sessions"] });
    }, 20_000);
    return () => window.clearInterval(id);
  }, [qc, busy]);

  // ---------------------------------------------------------------- actions
  function setUrl(id: string | null) {
    router.replace(id ? `/focus?task=${id}` : "/focus", { scroll: false });
  }

  function pickTask(t: Task) {
    setPicked(t.id);
    setSummary(null);
    setUrl(t.id);
  }

  async function startWork(t: Task | null) {
    if (busy) return null;
    setBusy(true);
    unlockAudio();
    const p = plannedFor(prefs, t, untilEventSeconds(events, Date.now()));
    if (prefs.mode === "until_event" && p.mode !== "until_event") toast("No event left today, so I'm counting up instead.");
    const s = await actions.start({ task_id: t?.id ?? null, mode: p.mode, planned_seconds: p.seconds, now: Date.now() });
    setBusy(false);
    if (s) {
      setSummary(null);
      if (t) {
        setPicked(t.id);
        setUrl(t.id);
      }
      setAnnouncement(`Started${t ? ` ${t.title}` : ""}.`);
    }
    return s;
  }

  async function startBreak() {
    if (!open || open.kind !== "work" || busy) return;
    setBusy(true);
    const t = Date.now();
    const asEnded = sessions.map((s) => (s.id === open.id ? endSession(s, t) : s));
    const pomo = open.mode === "pomodoro";
    const ph = pomo ? nextPhase(open, prefs.pomodoro, pomodorosInRun(asEnded, prefs.pomodoro, t)) : { kind: "break" as const, seconds: prefs.pomodoro.shortMin * 60, long: false };
    const s = await actions.start({ task_id: open.task_id, kind: "break", mode: pomo ? "pomodoro" : "countdown", planned_seconds: ph.seconds, now: t });
    setBusy(false);
    if (s) setAnnouncement(`${ph.long ? "Long break" : "Break"}, ${formatMinutes(ph.seconds / 60)}.`);
  }

  async function backToWork() {
    if (!open || open.kind !== "break" || busy) return;
    setBusy(true);
    const p = open.mode === "pomodoro" ? { mode: "pomodoro" as const, seconds: nextPhase(open, prefs.pomodoro, 0).seconds } : plannedFor(prefs, task, untilEventSeconds(events, Date.now()));
    const s = await actions.start({ task_id: open.task_id, mode: p.mode, planned_seconds: p.seconds, now: Date.now() });
    setBusy(false);
    if (s) setAnnouncement("Back to work.");
  }

  async function togglePause() {
    if (!open) return;
    const s = await (paused ? actions.resume(open) : actions.pause(open));
    if (s) setAnnouncement(paused ? "Resumed." : "Paused.");
  }

  function primary() {
    if (busy) return;
    if (!open) void startWork(task);
    else if (timeUp && !isBreak && open.mode === "pomodoro") void startBreak();
    else if (timeUp && isBreak) void backToWork();
    else void togglePause();
  }

  function addFive() {
    if (open && open.planned_seconds != null) void actions.extend(open, 300);
  }

  function nextTask() {
    const next = pickable.find((t) => t.id !== taskId);
    if (!next) {
      toast("That's everything on today's list.");
      return;
    }
    if (open) void startWork(next);
    else pickTask(next);
  }

  async function finish() {
    if (!open || busy) return;
    setBusy(true);
    const t = Date.now();
    const ended = await actions.end(open);
    if (!ended) return setBusy(false);
    if (task && !task.completed_at && !(await toggleComplete(task))) return setBusy(false);
    const all = sessions.map((s) => (s.id === ended.id ? ended : s));
    const mine = task ? all.filter((s) => s.task_id === task.id) : [ended];
    const est = task ? actualVsEstimate(all, task, t) : { actualMin: Math.round(elapsedMs(ended, t) / 60_000), estimateMin: null };
    setSummary({
      taskId: task?.id ?? null,
      title: task?.title ?? "Free focus",
      actualMin: est.actualMin,
      estimateMin: est.estimateMin,
      todayMin: Math.round(focusTotals(mine, t).workMs / 60_000),
      listId: task?.list_id ?? null,
      logged: false,
    });
    setPicked(null);
    setUrl(null);
    setBusy(false);
  }

  async function logHours() {
    if (!summary) return;
    const h = hoursForMinutes(summary.todayMin || summary.actualMin);
    const ok = await hours.upsert(newHoursLog({ date: ymd(new Date()), list_id: summary.listId, hours: h, note: summary.title }));
    if (!ok) return;
    setSummary({ ...summary, logged: true });
    toast(`Logged ${h} h`);
  }

  function changeSteps(steps: TaskStep[]) {
    if (task) void update(task, { steps });
  }

  function checkCurrentStep() {
    if (task && step) changeSteps(toggleStep(stepsOf(task), step.id));
  }

  async function parkThought(e: React.FormEvent) {
    e.preventDefault();
    const title = park.trim();
    if (!title) return;
    setPark("");
    if (await create({ title })) toast("Parked in Inbox");
    else setPark(title);
  }

  async function toggleAlerts() {
    unlockAudio();
    if (!prefs.alerts) {
      setPrefs({ alerts: true });
      playChime();
      if (perm === "default") setPerm(await askNotificationPermission());
    } else if (perm === "default") {
      setPerm(await askNotificationPermission());
    } else {
      setPrefs({ alerts: false });
    }
  }

  function exit() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  // ---------------------------------------------------------------- keyboard
  const act = useRef({ primary, startBreak, backToWork, addFive, nextTask, checkCurrentStep, exit, toggleFullscreen: fs.toggle, isBreak });
  useEffect(() => {
    act.current = { primary, startBreak, backToWork, addFive, nextTask, checkCurrentStep, exit, toggleFullscreen: fs.toggle, isBreak };
  });
  const blocked = !!(editor || quickAddOpen || searchOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const A = act.current;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        A.toggleFullscreen();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || blocked) return;
      const el = e.target as HTMLElement | null;
      if (e.key === "Escape") {
        if (isTypingTarget(el)) el?.blur();
        else A.exit();
        return;
      }
      if (isTypingTarget(el) || e.repeat) return;
      const k = e.key.toLowerCase();
      if (e.key === " ") {
        e.preventDefault();
        if (el && (el.tagName === "BUTTON" || el.tagName === "A")) el.blur();
        A.primary();
      } else if (e.key === "Enter") {
        // On a focused button, Enter belongs to the button.
        if (el && (el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "SUMMARY")) return;
        e.preventDefault();
        A.checkCurrentStep();
      } else if (k === "b") {
        if (A.isBreak) void A.backToWork();
        else void A.startBreak();
      } else if (k === "n") A.nextTask();
      else if (e.key === "+" || e.key === "=") A.addFive();
      else if (k === "f") A.toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocked]);

  // ---------------------------------------------------------------- render
  const primaryLabel = !open
    ? "Start"
    : timeUp && !isBreak && open.mode === "pomodoro"
      ? `Start break · ${formatMinutes(nextPhase(open, prefs.pomodoro, inRun + 1).seconds / 60)}`
      : timeUp && isBreak
        ? "Back to work"
        : paused
          ? "Resume"
          : "Pause";
  const primaryIcon = !open || paused || (timeUp && !isBreak && open.mode === "pomodoro") || (timeUp && isBreak) ? <IconPlay /> : <IconPause />;

  const ringTop = paused ? "Paused" : isBreak ? "Break" : open ? (open.mode === "pomodoro" ? `Focus ${inRun + 1}` : "Focus") : "Ready";
  const planned = open?.planned_seconds ?? null;
  const sub = open ? (
    over > 0 ? (
      <span className="num focus-over">{formatOver(over)}</span>
    ) : planned != null ? (
      <span className="num">of {formatClock(planned * 1000)}</span>
    ) : task?.duration_minutes != null ? (
      <span>est. {formatMinutes(takesMinutes(task))}</span>
    ) : (
      <span>counting up</span>
    )
  ) : (
    <span>
      {prefs.mode === "stopwatch" && "counting up"}
      {prefs.mode === "countdown" && "countdown"}
      {prefs.mode === "pomodoro" && `${prefs.pomodoro.workMin} + ${prefs.pomodoro.shortMin}`}
      {prefs.mode === "until_event" && (nextEvent && untilSeconds ? `until ${nextEvent.event.summary}` : "no event left today")}
    </span>
  );

  const clock = new Date(nowMs);
  // Only offer to log a real stretch of work (a 20 second blip isn't 0.1 hours).
  const ecs = summary ? lists.find((l) => l.id === summary.listId)?.area === "ecs" && (summary.todayMin || summary.actualMin) >= 3 : false;
  const summaryList = summary ? lists.find((l) => l.id === summary.listId) : undefined;
  const hasEnd = prefs.alerts;
  const bellLabel = !hasEnd ? "Turn on timer-end alerts" : perm === "default" ? "Allow notifications (the chime is on)" : "Timer-end alerts are on. Turn off";

  return (
    <div className="focus-layer fixed inset-0 z-[45] flex flex-col overflow-y-auto bg-paper text-ink" data-dim={prefs.dim ? "true" : "false"} role="region" aria-label="Focus mode">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {/* header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="order-2 flex min-w-0 basis-full items-center gap-2.5 sm:order-1 sm:basis-0 sm:flex-1">
          {list && <ListDot color={list.color} size={10} />}
          {list && <span className="shrink-0 text-sm text-ink2">{list.name}</span>}
          {list && <span aria-hidden className="text-ink3">·</span>}
          <h1 className="display min-w-0 truncate text-xl leading-tight sm:text-2xl">{summary ? "Finished" : heading}</h1>
        </div>
        <div className="order-1 ml-auto flex items-center gap-0.5 sm:order-2">
          <span className="num mr-2 text-lg font-light text-ink2" aria-label="Time now">
            {format(clock, "h:mm")}
            <span className="ml-1 text-xs uppercase text-ink3">{format(clock, "a")}</span>
          </span>
          <button type="button" className={iconBtn} aria-pressed={prefs.dim} aria-label="Dim mode" title="Dim mode, for late nights" onClick={() => setPrefs({ dim: !prefs.dim })} style={prefs.dim ? { color: "var(--accent)" } : undefined}>
            <IconMoon />
          </button>
          <span className="focus-aux flex items-center gap-0.5">
            <ThemeToggle className="max-sm:[&_span]:hidden" />
            <button type="button" className={iconBtn} aria-label={bellLabel} title={bellLabel} onClick={toggleAlerts} style={hasEnd ? { color: "var(--accent)" } : undefined}>
              {hasEnd ? <IconBell /> : <IconBellOff />}
            </button>
            {pip.supported && (
              <button type="button" className={iconBtn} aria-pressed={!!pip.win} aria-label="Floating mini-timer" title="Floating mini-timer" onClick={() => (pip.win ? pip.close() : void pip.open())} style={pip.win ? { color: "var(--accent)" } : undefined}>
                <IconPip />
              </button>
            )}
            <button type="button" className={iconBtn} aria-pressed={fs.full} aria-label="Full screen" title="Full screen (F)" onClick={fs.toggle}>
              <IconFullscreen exit={fs.full} />
            </button>
          </span>
          <button type="button" className={iconBtn} aria-label="Exit focus" title="Exit (Esc)" onClick={exit}>
            <IconX />
          </button>
        </div>
      </header>

      {sessionsQ.isError && (
        <p className="mx-5 mt-2 rounded-md bg-sheet2 px-3 py-2 text-sm text-ink2">The timer can&apos;t save yet: the database needs migration 0007 (supabase/migrations/0007_steps_focus.sql).</p>
      )}

      {conflict && open && (
        <div className="mx-5 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-sheet2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            You&apos;re timing another task. Focus on <strong className="font-semibold">{conflict.title}</strong> instead?
          </span>
          <button type="button" className="btn btn-primary !min-h-8" onClick={() => void startWork(conflict)}>
            Switch
          </button>
          <button type="button" className="btn btn-ghost !min-h-8" onClick={() => setDismissedSwitch(true)}>
            Keep going
          </button>
        </div>
      )}

      <main className="mx-auto grid w-full max-w-[96rem] flex-1 content-center gap-8 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-12">
        {/* left: steps */}
        <div className="focus-aux order-3 lg:order-1 lg:max-h-[70vh] lg:self-center lg:overflow-y-auto lg:pr-1">{task && !summary && <StepsPanel key={task.id} task={task} onChange={changeSteps} />}</div>

        {/* center: timer */}
        <div className="order-1 min-w-0 lg:order-2">
          {summary ? (
            <div className="anim-pop mx-auto grid max-w-md gap-5 py-6 text-center">
              <p className="display text-4xl leading-tight sm:text-5xl">{summary.actualMin >= 1 ? `Nice — ${formatMinutes(summary.actualMin)}` : "Nice — done"}</p>
              {summary.estimateMin != null && summary.actualMin >= 1 && <p className="num -mt-2 text-ink2">est. {formatMinutes(summary.estimateMin)}</p>}
              <p className="text-ink2">{summary.title} is checked off.</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {ecs && !summary.logged && summaryList && (
                  <button type="button" className="btn" onClick={logHours}>
                    Log {hoursForMinutes(summary.todayMin || summary.actualMin)} h to {summaryList.name}
                  </button>
                )}
                {ecs && summary.logged && <span className="chip">Hours logged</span>}
              </div>
              {suggestion ? (
                <div className="rounded-lg border border-rulestrong px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-ink3">Next up</p>
                  <p className="display mt-1 truncate text-xl">{suggestion.title}</p>
                  <button type="button" className="btn btn-primary mt-3 !rounded-full !px-6" onClick={() => void startWork(suggestion)} disabled={busy}>
                    <IconPlay /> Start
                  </button>
                </div>
              ) : (
                <p className="text-ink3">That&apos;s everything on your list for now.</p>
              )}
              <div>
                <button type="button" className="btn btn-ghost text-ink2" onClick={exit}>
                  Done for now
                </button>
              </div>
            </div>
          ) : (
            <>
              <TimerRing fraction={open ? ringFraction(open, nowMs) : 0} tone={tone} paused={paused} time={time} top={ringTop}>
                {sub}
              </TimerRing>

              {/* the step to do right now */}
              <div className="mx-auto mt-5 flex h-9 max-w-md items-center justify-center gap-3 text-center">
                {isBreak ? (
                  <p className="text-ink2">Rest your eyes. Look at something far away.</p>
                ) : step && task ? (
                  <>
                    <TaskCheck done={false} label={`Check ${step.title}`} onToggle={checkCurrentStep} />
                    <p className="min-w-0 truncate text-lg">
                      <span className="mr-2 text-xs uppercase tracking-[0.18em] text-ink3">Now</span>
                      {step.title}
                    </p>
                  </>
                ) : null}
              </div>

              {/* controls */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button type="button" className="btn btn-primary !h-14 !rounded-full !px-8 !text-lg" onClick={primary} disabled={busy || sessionsQ.isLoading} aria-keyshortcuts="Space" title="Space">
                  {primaryIcon}
                  {primaryLabel}
                </button>
                {open && planned != null && (
                  <button type="button" className="btn !h-11 !rounded-full" onClick={addFive} aria-keyshortcuts="+" title="Add 5 minutes (+)">
                    <IconPlus width={15} height={15} /> 5 min
                  </button>
                )}
                {open && (
                  <button type="button" className="btn !h-11 !rounded-full" onClick={() => void (isBreak ? backToWork() : startBreak())} disabled={busy} aria-keyshortcuts="B" title={isBreak ? "Skip the break (B)" : "Take a break (B)"}>
                    {isBreak ? <IconSkip width={15} height={15} /> : <IconCoffee width={16} height={16} />}
                    {isBreak ? "Skip break" : "Break"}
                  </button>
                )}
                {open && (
                  <button type="button" className="btn !h-11 !rounded-full" onClick={() => void finish()} disabled={busy} title={task ? "Finish and check the task off" : "Finish"}>
                    Done
                  </button>
                )}
                {pickable.length > 1 && (
                  <button type="button" className="btn btn-ghost !h-11 !rounded-full text-ink2" onClick={nextTask} aria-keyshortcuts="N" title="Next task (N)">
                    Next task
                  </button>
                )}
              </div>

              {/* mode */}
              {ready && (
                <div className="focus-aux mt-6 grid justify-items-center gap-3">
                  <div role="radiogroup" aria-label="Timer mode" className="inline-flex max-w-full flex-wrap justify-center overflow-hidden rounded-md border border-rulestrong">
                    {MODES.map((m) => (
                      <button key={m.id} type="button" role="radio" aria-checked={prefs.mode === m.id} onClick={() => setPrefs({ mode: m.id })} className={`px-3 py-1.5 text-sm ${prefs.mode === m.id ? "bg-accent text-accentink" : "hover:bg-sheet2"}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {prefs.mode === "countdown" && (
                    <div className="flex flex-wrap items-center justify-center gap-1.5" role="radiogroup" aria-label="Countdown length">
                      {COUNTDOWN_PRESETS.map((m) => (
                        <Chip key={m} on={prefs.countdown === m} onClick={() => {
                          setCustomOpen(false);
                          setPrefs({ countdown: m });
                        }}>
                          {m} min
                        </Chip>
                      ))}
                      {task && (
                        <Chip on={prefs.countdown === "estimate"} onClick={() => {
                            setCustomOpen(false);
                            setPrefs({ countdown: "estimate" });
                          }}>
                          Estimate · {formatTakes(takesMinutes(task))}
                        </Chip>
                      )}
                      <Chip on={customOpen || (prefs.countdown !== "estimate" && !(COUNTDOWN_PRESETS as readonly number[]).includes(prefs.countdown))} onClick={() => setCustomOpen(true)}>
                        Custom
                      </Chip>
                      {(customOpen || (prefs.countdown !== "estimate" && !(COUNTDOWN_PRESETS as readonly number[]).includes(prefs.countdown))) && (
                        <label className="flex items-center gap-1.5 text-sm text-ink2">
                          <input
                            type="number"
                            min={1}
                            max={600}
                            inputMode="numeric"
                            className="field !min-h-8 !w-20 !py-0.5 text-center"
                            aria-label="Custom minutes"
                            value={typeof prefs.countdown === "number" ? prefs.countdown : ""}
                            onChange={(e) => e.target.value && setPrefs({ countdown: Math.min(600, Math.max(1, Math.round(Number(e.target.value)))) })}
                          />
                          min
                        </label>
                      )}
                    </div>
                  )}

                  {prefs.mode === "pomodoro" && (
                    <div className="grid justify-items-center gap-2 text-sm text-ink2">
                      <p>
                        {prefs.pomodoro.workMin} min focus, {prefs.pomodoro.shortMin} min break, {prefs.pomodoro.longMin} min long break after {prefs.pomodoro.every}.{" "}
                        <button type="button" className="underline decoration-ink3 underline-offset-2 hover:text-ink" onClick={() => setPomoOpen(!pomoOpen)} aria-expanded={pomoOpen}>
                          {pomoOpen ? "Done" : "Change"}
                        </button>
                      </p>
                      {pomoOpen && (
                        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                          {(
                            [
                              ["workMin", "Focus", 1, 180],
                              ["shortMin", "Break", 1, 60],
                              ["longMin", "Long", 1, 90],
                              ["every", "Long after", 2, 12],
                            ] as const
                          ).map(([key, label, lo, hi]) => (
                            <label key={key} className="flex items-center gap-1.5">
                              {label}
                              <input
                                type="number"
                                min={lo}
                                max={hi}
                                inputMode="numeric"
                                className="field !min-h-8 !w-16 !py-0.5 text-center"
                                value={prefs.pomodoro[key]}
                                onChange={(e) => e.target.value && setPrefs({ pomodoro: { ...prefs.pomodoro, [key]: Math.min(hi, Math.max(lo, Math.round(Number(e.target.value)))) } })}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {prefs.mode === "until_event" && (
                    <p className="text-sm text-ink2">
                      {nextEvent && untilSeconds
                        ? `Counts down to 5 minutes before ${nextEvent.event.summary} (${formatTime(nextEvent.start)}): ${formatMinutes(untilSeconds / 60)} of focus.`
                        : "No event left today to count down to. This will count up instead."}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* right: what's next */}
        <div className="order-4 grid min-w-0 content-center gap-5 lg:self-center">
          {soon && !summary && <EventWarning event={soon.event} minutes={soon.minutes} />}
          {ready ? <TaskPicker tasks={pickable} lists={lists} selectedId={task?.id ?? null} suggestedId={suggestion?.id ?? null} onPick={pickTask} /> : <UpNext items={upNext} lists={lists} calendars={calendars} onPick={(t) => (open ? void startWork(t) : pickTask(t))} />}
        </div>
      </main>

      {/* footer */}
      <footer className="focus-aux grid gap-3 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 md:flex md:items-center md:gap-6">
        <form onSubmit={parkThought} className="min-w-0 flex-1 md:max-w-xl">
          <label className="sr-only" htmlFor="focus-park">
            Park a thought
          </label>
          <input id="focus-park" className="field" placeholder="Park a thought… (goes to Inbox)" value={park} onChange={(e) => setPark(e.target.value)} autoComplete="off" />
        </form>
        <p className="hidden flex-1 text-center text-xs text-ink3 xl:block">Space pause · B break · N next · + 5 min · F full screen · Esc exit</p>
        <div className="flex items-center gap-3 text-sm text-ink2 md:ml-auto" aria-label="Focused today">
          <span className="num">{totals.workMs >= 60_000 ? `${formatFocused(totals.workMs)} focused` : "Nothing focused yet today"}</span>
          <span className="flex items-center gap-1" aria-hidden>
            {Array.from({ length: Math.min(totals.completed, 10) }, (_, i) => (
              <span key={i} className="h-2 w-2 rounded-full bg-accent" />
            ))}
            {totals.completed > 10 && <span className="num text-xs text-ink3">+{totals.completed - 10}</span>}
            {open && !isBreak && <span className={`h-2 w-2 rounded-full border border-accent ${running ? "focus-pulse" : ""}`} />}
          </span>
        </div>
      </footer>

      {pip.win && open && (
        <MiniTimer
          win={pip.win}
          title={isBreak ? "Break" : (task?.title ?? "Focus")}
          color={list?.color ?? null}
          time={time}
          sub={paused ? "Paused" : over > 0 ? formatOver(over) : planned != null ? `of ${formatClock(planned * 1000)}` : "counting up"}
          paused={paused}
          step={isBreak ? null : (step?.title ?? null)}
          onToggle={() => void togglePause()}
          onCheckStep={checkCurrentStep}
        />
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={`chip cursor-pointer transition-colors ${on ? "!border-transparent !bg-accent !text-accentink" : "hover:bg-sheet2"}`}>
      {children}
    </button>
  );
}

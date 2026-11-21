"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { format } from "@/lib/dates";
import { describeRrule, toEventRrule } from "@/lib/recurrence";
import { parseQuickAdd, type Parsed } from "@/lib/quickadd";
import { dumpToText, parseBrainDump, splitBrainDump, type ParsedDumpItem } from "@/lib/braindump";
import { newStep } from "@/lib/steps";
import { normalizeDictation, pickAlternative } from "@/lib/dictation";
import { formatTime } from "@/lib/dates";
import { newHoursLog, useCalendars, useEventActions, useGoogleStatus, useLists, useReminderSettings, useRowMutations, useTaskActions } from "@/lib/hooks";
import { DEFAULT_OFFSET_CHOICES, offsetLabel, type ReminderSettings } from "@/lib/reminders";
import { useUi } from "@/lib/ui";
import { formatTakes } from "@/lib/timeline";
import { Dialog } from "./dialog";
import { ListDot } from "./bits";
import { IconFlag, IconMic, IconStar } from "./icons";

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
  // No list and no date: it lands in the Inbox to be sorted out later.
  if (p.kind === "task" && !p.listId && !p.due) chips.push(<span key="inbox" className="chip">→ Inbox</span>);
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

// ---- dictation: the browser's own speech recognition (Chrome, Edge, Safari incl. iPhone)

interface SpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; length: number; [j: number]: { transcript: string } };
}
interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognizerCtor = new () => Recognizer;

const recognizerCtor = (): RecognizerCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const noSubscribe = () => () => {};

const DICTATION_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in the browser's site settings.",
  "service-not-allowed": "Dictation isn't available in this browser.",
  "audio-capture": "No microphone found.",
  network: "Dictation needs an internet connection.",
  "no-speech": "Didn't catch that. Tap the mic and try again.",
  "language-not-supported": "English dictation isn't available on this device.",
};

interface DictationHandlers {
  /** Every result so far: final ones carry all the recogniser's alternatives, best first. */
  onResults: (results: { final: boolean; alternatives: string[] }[]) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

function useDictation() {
  const supported = useSyncExternalStore(noSubscribe, () => recognizerCtor() != null, () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognizer | null>(null);
  useEffect(() => () => rec.current?.abort(), []);

  function start(h: DictationHandlers) {
    const Ctor = recognizerCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    // The parser reads English, so ask for English even on a device set to another language.
    r.lang = navigator.language?.toLowerCase().startsWith("en") ? navigator.language : "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 5;
    r.onresult = (e) => {
      const out: { final: boolean; alternatives: string[] }[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const alternatives: string[] = [];
        for (let j = 0; j < res.length; j++) alternatives.push(res[j].transcript);
        out.push({ final: res.isFinal, alternatives });
      }
      h.onResults(out);
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") h.onError(DICTATION_ERRORS[e.error] ?? "Dictation stopped unexpectedly.");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      h.onEnd();
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      h.onError("Dictation couldn't start.");
    }
  }

  return { supported, listening, start, stop: () => rec.current?.stop() };
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation();
  /** The words as heard, shown under the box so a misheard word is easy to spot. */
  const [heard, setHeard] = useState("");
  /** Items of a multi-item preview the user has unticked, by their text. */
  const [off, setOff] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function toggleDictation() {
    if (dictation.listening) return dictation.stop();
    const typed = text.trim();
    setHeard("");
    dictation.start({
      onResults(results) {
        const spoken = results
          .map((r) => (r.final ? pickAlternative(r.alternatives, lists) : r.alternatives[0] ?? ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        setHeard(spoken);
        // Several sentences ("buy milk. email bob") become one line each, so the multi-item preview takes over.
        const pieces = splitBrainDump(spoken);
        if (pieces.length < 2 && !pieces[0]?.steps.length) return setText([typed, normalizeDictation(spoken, lists)].filter(Boolean).join(" "));
        const spokenLines = dumpToText(pieces.map((it) => ({ ...it, line: normalizeDictation(it.line, lists) })));
        setText([typed, spokenLines].filter(Boolean).join("\n"));
      },
      onEnd: () => inputRef.current?.focus(),
      onError: toast,
    });
  }

  /** Fills in the list this box was opened for when the text names none. */
  const withDefault = useMemo(
    () => (p: Parsed): Parsed => {
      if (defaultListId && "listId" in p && !p.listId) {
        const l = lists.find((x) => x.id === defaultListId);
        return { ...p, listId: defaultListId, listName: l?.name ?? null } as Parsed;
      }
      return p;
    },
    [lists, defaultListId],
  );
  // One line with nothing to split is the plain flow; several lines or sentences switch to the preview.
  const dump = useMemo<ParsedDumpItem[]>(() => {
    if (!/\n/.test(text) && splitBrainDump(text).length < 2) return [];
    return parseBrainDump(text, lists).map((it) => ({ ...it, parsed: withDefault(it.parsed) }));
  }, [text, lists, withDefault]);
  const multi = dump.length >= 2;
  const chosen = dump.filter((it) => !off.has(it.source));
  const parsed = useMemo(() => {
    // Indented step lines aren't part of the title, so a lone item with steps comes from the splitter too
    if (dump.length === 1) return dump[0].parsed;
    return withDefault(parseQuickAdd(text, lists));
  }, [text, lists, dump, withDefault]);
  const singleSteps = dump.length === 1 ? dump[0].steps : [];
  const defaultCal = calendars.find((c) => c.enabled && c.is_default && !c.read_only) ?? calendars.find((c) => c.enabled && !c.read_only);

  /** Saves one parsed item; resolves to a toast line for a single add, or null if the save failed (already reported). */
  async function save(p: Parsed, steps: string[]): Promise<{ kind: "task" | "event" | "hours"; message: string } | null> {
    // A checklist is only written when there is one, so saving works on a database that predates migration 0007.
    const stepFields = steps.length ? { steps: steps.map(newStep) } : {};
    if (p.kind === "empty") return null;
    if (p.kind === "hours") {
      if (!(await hours.upsert(newHoursLog({ date: format(p.date, "yyyy-MM-dd"), hours: p.hours, list_id: p.listId, note: p.note })))) return null;
      return { kind: "hours", message: `Logged ${p.hours} h${p.listName ? ` to ${p.listName}` : ""}` };
    }
    if (p.kind === "event") {
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
        if (!ev) return null;
        return { kind: "event", message: `Added to ${defaultCal.summary}` };
      }
      const saved = await tasks.create({ title: p.title || "Untitled", due_at: p.start.toISOString(), all_day: false, list_id: p.listId, starred: p.starred, flagged: p.flagged, rrule: p.rrule, ...stepFields });
      if (!saved) return null;
      return { kind: "task", message: "Google Calendar isn't connected, so that went in as a timed task." };
    }
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
      ...stepFields,
    });
    if (!saved) return null;
    return { kind: "task", message: p.listName ? `Added to ${p.listName}` : !p.due ? "Added to Inbox" : "Task added" };
  }

  function finish() {
    setText("");
    setHeard("");
    setOff(new Set());
    onDone?.();
    inputRef.current?.focus();
  }

  async function submit() {
    if (saving) return;
    if (multi) return submitAll();
    const p = parsed;
    if (p.kind === "empty") return;
    // A failed save has already told the user why; keep the text so they can try again, and don't announce success.
    const done = await save(p, singleSteps);
    if (!done) return;
    toast(done.message);
    finish();
  }

  /** Saves every ticked item in order. A failure stops the run and leaves the unsaved items in the box. */
  async function submitAll() {
    if (!chosen.length) return;
    setSaving(true);
    const counts = { task: 0, event: 0, hours: 0 };
    const saved = new Set<ParsedDumpItem>();
    try {
      for (const it of chosen) {
        const done = await save(it.parsed, it.steps);
        if (!done) break;
        counts[done.kind]++;
        saved.add(it);
      }
    } finally {
      setSaving(false);
    }
    const parts = [
      counts.task && `${counts.task} ${counts.task === 1 ? "task" : "tasks"}`,
      counts.event && `${counts.event} ${counts.event === 1 ? "event" : "events"}`,
      counts.hours && `${counts.hours} hours ${counts.hours === 1 ? "entry" : "entries"}`,
    ].filter(Boolean) as string[];
    if (parts.length) toast(`${counts.hours && !counts.task && !counts.event ? "Logged" : "Added"} ${parts.join(" and ")}`);
    if (saved.size === chosen.length) return finish();
    // Keep what wasn't saved (failed or unticked) so nothing typed is lost.
    setText(dumpToText(dump.filter((it) => !saved.has(it)).map((it) => ({ line: it.source, steps: it.steps }))));
    setOff(new Set());
  }

  // The box grows with its text (one row until there are several lines).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

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
      <div className="relative">
        <textarea
          id="quick-add"
          ref={inputRef}
          rows={1}
          data-autofocus={autoFocus ? "" : undefined}
          autoFocus={autoFocus}
          className={`field !min-h-11 resize-none !text-base ${dictation.supported ? "!pr-12" : ""}`}
          placeholder={dictation.listening && !text ? "Listening…" : placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHeard("");
          }}
          onKeyDown={(e) => {
            // Enter saves (all the ticked items, in a list); Shift+Enter adds a line
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          autoComplete="off"
          enterKeyHint="done"
        />
        {dictation.supported && (
          <button
            type="button"
            onClick={toggleDictation}
            aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
            aria-pressed={dictation.listening}
            title={dictation.listening ? "Stop dictation" : "Dictate"}
            className={`absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink2 transition-colors hover:bg-sheet2 ${dictation.listening ? "mic-listening" : ""}`}
          >
            <IconMic />
          </button>
        )}
      </div>
      {(dictation.listening || heard) && (
        <p className="mt-1.5 text-xs text-ink3" aria-live="polite">
          {heard ? <>Heard: “{heard}”</> : "Listening… try “HOSA meeting Tuesday from 3 to 4”"}
        </p>
      )}
      {multi ? (
        <div className="mt-3">
          <p className="mb-1 text-xs text-ink3">{dump.length} items</p>
          <ul className="grid">
            {dump.map((it, i) => (
              <li key={`${i}:${it.source}`} className="border-t border-rule py-2 first:border-t-0">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                    checked={!off.has(it.source)}
                    onChange={() =>
                      setOff((prev) => {
                        const next = new Set(prev);
                        if (!next.delete(it.source)) next.add(it.source);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {it.parsed.kind === "hours" ? it.parsed.note || "Hours" : it.parsed.kind === "empty" ? "" : it.parsed.title || "Untitled"}
                    </span>
                    {it.steps.length > 0 && it.parsed.kind === "task" && (
                      <span className="text-xs text-ink3">
                        {it.steps.length} {it.steps.length === 1 ? "step" : "steps"}
                      </span>
                    )}
                    <Chips p={it.parsed} lists={lists} settings={settings} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button type="submit" className="btn btn-primary mt-2" disabled={saving || chosen.length === 0}>
            {saving ? "Adding…" : `Add ${chosen.length}`}
          </button>
        </div>
      ) : (
        <>
          <Chips p={parsed} lists={lists} settings={settings} />
          {singleSteps.length > 0 && <p className="mt-1.5 text-xs text-ink3">{singleSteps.length} {singleSteps.length === 1 ? "step" : "steps"}</p>}
        </>
      )}
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
  ["Inbox:", "no #list and no date"],
  ["Several:", "one per line, or “…; …”"],
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
        <p className="mt-4 text-xs text-ink3">Press Enter to add, Shift+Enter for another line. Esc to close.</p>
      </div>
    </Dialog>
  );
}

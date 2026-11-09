"use client";

import { useEffect, useSyncExternalStore } from "react";
import { formatTime } from "@/lib/dates";
import { SCHEDULE_KEY, THEME_COLOR, THEME_KEY, nextSwitch, parseSchedule, scheduledTheme, type Schedule, type ThemeMode } from "@/lib/theme";
import { IconMoon, IconSun } from "./icons";

const EVENT = "sd-theme-change";

function read(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark" || saved === "schedule") return saved;
  } catch {}
  return "system";
}

function readScheduleRaw(): string | null {
  try {
    return localStorage.getItem(SCHEDULE_KEY);
  } catch {
    return null;
  }
}

/** The palette actually showing right now. */
function effective(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (mode === "schedule") return scheduledTheme(new Date(), parseSchedule(readScheduleRaw()));
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Put the right palette, address-bar colour and tab icon on the page for the saved mode. */
function paint() {
  const mode = read();
  const el = document.documentElement;
  const now = effective(mode);
  if (mode === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", now);
  // Next renders one theme-color per OS scheme; a chosen theme should win over the OS.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const forOs = m.media.includes("dark") ? THEME_COLOR.dark : THEME_COLOR.light;
    m.content = mode === "system" ? forOs : THEME_COLOR[now];
  });
  // Tab icon (and the icon iPhone saves if you Add to Home Screen right now).
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => {
    const url = new URL(l.href, location.href);
    if (!url.pathname.startsWith("/pwa-icon/")) return;
    if (now === "dark") url.searchParams.set("theme", "dark");
    else url.searchParams.delete("theme");
    if (url.href !== l.href) l.href = url.href;
  });
}

function save(mode: ThemeMode) {
  try {
    if (mode === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {}
  paint();
  // Keep every toggle on the page (sidebar + Settings) in agreement.
  window.dispatchEvent(new Event(EVENT));
}

function saveSchedule(s: Schedule) {
  try {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(s));
  } catch {}
  paint();
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb); // other tabs
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useTheme() {
  const mode = useSyncExternalStore<ThemeMode>(subscribe, read, () => "system");
  const raw = useSyncExternalStore(subscribe, readScheduleRaw, () => null);
  return { mode, set: save, schedule: parseSchedule(raw), setSchedule: saveSchedule };
}

/**
 * Mounted once at the root. Flips the scheduled theme at its set times while the app is open,
 * and re-checks when the app comes back (timers don't run while a phone or laptop sleeps).
 */
export function ThemeClock() {
  const { mode, schedule } = useTheme();
  const { light, dark } = schedule;
  useEffect(() => {
    paint();
    const os = matchMedia("(prefers-color-scheme: dark)");
    const onWake = () => {
      if (document.visibilityState === "visible") paint();
    };
    os.addEventListener("change", paint);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", paint);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (mode !== "schedule") return;
      // +1s so the check lands just after the boundary minute starts.
      const ms = nextSwitch(new Date(), { light, dark }).getTime() - Date.now() + 1000;
      timer = setTimeout(() => {
        paint();
        arm();
      }, Math.min(ms, 2 ** 31 - 1));
    };
    arm();
    return () => {
      clearTimeout(timer);
      os.removeEventListener("change", paint);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", paint);
    };
  }, [mode, light, dark]);
  return null;
}

const LABEL: Record<ThemeMode, string> = { system: "Auto", light: "Paper", dark: "Lamplight", schedule: "Scheduled" };

/** Compact cycle button: auto -> scheduled -> paper -> lamplight. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode, set } = useTheme();
  const order: ThemeMode[] = ["system", "schedule", "light", "dark"];
  const next = order[(order.indexOf(mode) + 1) % order.length];
  // mode is "system" while hydrating, so this only reads the clock on the client.
  const isDark = mode === "dark" || (mode === "schedule" && effective(mode) === "dark");
  return (
    <button
      type="button"
      className={`btn btn-ghost !px-2 ${className}`}
      onClick={() => set(next)}
      aria-label={`Theme: ${LABEL[mode]}. Switch to ${LABEL[next]}`}
      title={`Theme: ${LABEL[mode]}`}
    >
      {isDark ? <IconMoon /> : <IconSun />}
      <span className="text-sm text-ink2">{LABEL[mode]}</span>
    </button>
  );
}

function clockLabel(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return formatTime(new Date(2000, 0, 1, h, m));
}

export function ThemePicker() {
  const { mode, set, schedule, setSchedule } = useTheme();
  const opts: { id: ThemeMode; label: string }[] = [
    { id: "system", label: "Match device" },
    { id: "schedule", label: "Scheduled" },
    { id: "light", label: "Paper" },
    { id: "dark", label: "Lamplight" },
  ];
  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Theme" className="inline-flex w-fit overflow-hidden rounded-md border border-rulestrong">
        {opts.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={mode === o.id}
            onClick={() => set(o.id)}
            className={`px-3 py-1.5 text-sm ${mode === o.id ? "bg-accent text-accentink" : "hover:bg-sheet2"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {mode === "schedule" && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink2">
          <label className="flex items-center gap-2">
            <IconSun /> Paper from
            <input
              type="time"
              className="field !w-auto"
              value={schedule.light}
              onChange={(e) => e.target.value && setSchedule({ ...schedule, light: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <IconMoon /> Lamplight from
            <input
              type="time"
              className="field !w-auto"
              value={schedule.dark}
              onChange={(e) => e.target.value && setSchedule({ ...schedule, dark: e.target.value })}
            />
          </label>
          <p className="w-full text-xs text-ink3">
            {schedule.light === schedule.dark
              ? "Pick two different times."
              : `Paper ${clockLabel(schedule.light)} to ${clockLabel(schedule.dark)}, Lamplight the rest of the night. Saved on this device.`}
          </p>
        </div>
      )}
    </div>
  );
}

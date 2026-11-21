"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_FOCUS_PREFS, FOCUS_PREFS_KEY, parseFocusPrefs, type FocusPrefs } from "@/lib/focus";

// ------------------------------------------------------------------ remembered choices (per device)

const EVENT = "sd-focus-change";
let cache: { raw: string; prefs: FocusPrefs } | null = null;

function read(): FocusPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(FOCUS_PREFS_KEY);
  } catch {}
  // Storage blocked or empty: fall back to what this tab last chose.
  if (raw === null) return cache?.prefs ?? DEFAULT_FOCUS_PREFS;
  if (cache?.raw === raw) return cache.prefs;
  cache = { raw, prefs: parseFocusPrefs(raw) };
  return cache.prefs;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Last mode, countdown length, pomodoro lengths, alerts and dim choice. Saved in localStorage; fine without it. */
export function useFocusPrefs(): [FocusPrefs, (patch: Partial<FocusPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, read, () => DEFAULT_FOCUS_PREFS);
  const update = useCallback((patch: Partial<FocusPrefs>) => {
    const next = { ...read(), ...patch };
    const raw = JSON.stringify(next);
    cache = { raw, prefs: next };
    try {
      localStorage.setItem(FOCUS_PREFS_KEY, raw);
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [prefs, update];
}

// ------------------------------------------------------------------ clock

/**
 * Current time in ms, re-rendering once per second while a timer runs (aligned to the second the timer flips on, so the
 * digits change exactly when they should) and once a minute otherwise (the wall clock). One timer, no drift: everything
 * shown is computed from timestamps. `win` is the Picture-in-Picture window when it's open: its timers aren't throttled
 * when the main window is hidden behind other apps.
 */
export function useNow(running: boolean, anchor: number, win?: Window | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const w = win ?? window;
    let id = 0;
    const delayFor = (t: number) => (running ? 1000 - ((((t - anchor) % 1000) + 1000) % 1000) + 12 : 60_000 - (t % 60_000) + 60);
    const tick = () => {
      const t = Date.now();
      setNow(t);
      id = w.setTimeout(tick, delayFor(t));
    };
    tick(); // show the right time right away (the mode just changed), then keep to the second
    // A laptop that slept, or a tab that was hidden, catches up the moment it's back.
    const wake = () => setNow(Date.now());
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      w.clearTimeout(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [running, anchor, win]);
  return now;
}

// ------------------------------------------------------------------ screen wake lock

/** Keeps the screen on while `active`. Re-acquired when the tab comes back (the browser drops it when hidden). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (stopped || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (stopped) void l.release().catch(() => {});
        else lock = l;
      } catch {
        // denied (battery saver, no permission): the screen just sleeps as usual
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

// ------------------------------------------------------------------ fullscreen

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const fsElement = () => (document as FsDoc).fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;

export function useFullscreen() {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(!!fsElement());
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    on();
    return () => {
      document.removeEventListener("fullscreenchange", on);
      document.removeEventListener("webkitfullscreenchange", on);
    };
  }, []);
  const toggle = useCallback(() => {
    const d = document as FsDoc;
    const el = document.documentElement as FsEl;
    // The whole page, not just the focus layer, so toasts and dialogs still show.
    if (fsElement()) void (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())?.catch?.(() => {});
    else void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch?.(() => {});
  }, []);
  return { full, toggle };
}

// ------------------------------------------------------------------ alerts

let audio: AudioContext | null = null;

/** Create the audio context. Call it from a click (Start): browsers only allow sound after a gesture. */
export function unlockAudio() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === "suspended") void audio.resume();
  } catch {}
}

/** A soft three-note bell (E, G#, B), made with WebAudio so there are no files to load. */
export function playChime() {
  try {
    unlockAudio();
    if (!audio) return;
    const ctx = audio;
    const t0 = ctx.currentTime + 0.02;
    [659.25, 830.61, 987.77].forEach((freq, i) => {
      const t = t0 + i * 0.22;
      for (const [mult, peak] of [[1, 0.1], [2, 0.025]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 1.9);
      }
    });
  } catch {}
}

export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window;
export const notificationPermission = (): NotificationPermission | "unsupported" => (notificationsSupported() ? Notification.permission : "unsupported");

/** Ask for permission. Only ever called from a click on the bell. */
export async function askNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** A system notification, if permission was granted. Phones only allow it through the service worker. */
export function notify(title: string, body: string) {
  if (notificationPermission() !== "granted") return;
  const opts: NotificationOptions = { body, tag: "focus-end", icon: "/pwa-icon/192" };
  try {
    new Notification(title, opts);
  } catch {
    void navigator.serviceWorker?.getRegistration().then((r) => r?.showNotification(title, opts)).catch(() => {});
  }
}

// ------------------------------------------------------------------ misc

/** Sets the tab title while `title` is non-null, and puts the old one back after. */
export function useDocumentTitle(title: string | null) {
  const [original] = useState(() => (typeof document === "undefined" ? "" : document.title));
  useEffect(() => {
    document.title = title ?? original;
  }, [title, original]);
  useEffect(
    () => () => {
      document.title = original;
    },
    [original],
  );
}

/** True when typing in a field: single-key shortcuts must stay out of the way. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

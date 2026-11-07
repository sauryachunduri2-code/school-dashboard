"use client";

import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "./icons";

type Mode = "system" | "light" | "dark";

const EVENT = "sd-theme-change";

function read(): Mode {
  try {
    const saved = localStorage.getItem("sd-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "system";
}

function apply(mode: Mode) {
  const el = document.documentElement;
  if (mode === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", mode);
  try {
    if (mode === "system") localStorage.removeItem("sd-theme");
    else localStorage.setItem("sd-theme", mode);
  } catch {}
  // Keep every toggle on the page (sidebar + Settings) in agreement.
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
  const mode = useSyncExternalStore<Mode>(subscribe, read, () => "system");
  return { mode, set: apply };
}

/** Compact cycle button: system -> light -> dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode, set } = useTheme();
  const next: Mode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
  return (
    <button
      type="button"
      className={`btn btn-ghost !px-2 ${className}`}
      onClick={() => set(next)}
      aria-label={`Theme: ${mode}. Switch to ${next}`}
      title={`Theme: ${mode}`}
    >
      {mode === "dark" ? <IconMoon /> : <IconSun />}
      <span className="text-sm text-ink2">{mode === "system" ? "Auto" : mode === "light" ? "Light" : "Lamplight"}</span>
    </button>
  );
}

export function ThemePicker() {
  const { mode, set } = useTheme();
  const opts: { id: Mode; label: string }[] = [
    { id: "system", label: "Match device" },
    { id: "light", label: "Paper" },
    { id: "dark", label: "Lamplight" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex overflow-hidden rounded-md border border-rulestrong">
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
  );
}

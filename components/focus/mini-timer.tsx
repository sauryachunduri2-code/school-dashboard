"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { IconPause, IconPlay, InkCheck } from "@/components/icons";

// Document Picture-in-Picture (Chrome / Edge on desktop): a small always-on-top window with its own document.
interface DocumentPip {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}
const pipApi = (): DocumentPip | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture);

const noop = () => () => {};

/** Copies the page's CSS into the PiP window, and keeps its theme in step with the page. Returns a cleanup. */
function mirrorStyles(win: Window): () => void {
  const src = document.documentElement;
  const dst = win.document.documentElement;
  dst.className = src.className; // carries the font variables
  dst.lang = src.lang;
  const theme = () => {
    const t = src.getAttribute("data-theme");
    if (t) dst.setAttribute("data-theme", t);
    else dst.removeAttribute("data-theme");
  };
  theme();
  const mo = new MutationObserver(theme);
  mo.observe(src, { attributes: true, attributeFilter: ["data-theme"] });

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = win.document.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      win.document.head.appendChild(style);
    } catch {
      // a cross-origin sheet can't be read: link it instead
      if (sheet.href) {
        const link = win.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        win.document.head.appendChild(link);
      }
    }
  }
  const base = win.document.createElement("style");
  base.textContent = "html,body{margin:0;height:100%;overflow:hidden}body::before{display:none}";
  win.document.head.appendChild(base);
  return () => mo.disconnect();
}

/** Open / close the floating mini-timer. `supported` is false in Safari and Firefox, so the button can be hidden. */
export function usePip() {
  const supported = useSyncExternalStore(noop, () => !!pipApi(), () => false);
  const [win, setWin] = useState<Window | null>(null);
  const current = useRef<Window | null>(null);

  const open = useCallback(async () => {
    const api = pipApi();
    if (!api) return;
    try {
      const w = await api.requestWindow({ width: 320, height: 190 });
      const stop = mirrorStyles(w);
      w.addEventListener("pagehide", () => {
        stop();
        current.current = null;
        setWin(null);
      });
      current.current = w;
      setWin(w);
    } catch {
      // refused (no user gesture, or one is already open)
    }
  }, []);

  const close = useCallback(() => {
    current.current?.close();
    current.current = null;
    setWin(null);
  }, []);

  // Leaving the page takes the mini-timer with it.
  useEffect(() => () => close(), [close]);
  return { supported, win, open, close };
}

export interface MiniProps {
  win: Window;
  title: string;
  color: string | null;
  time: string;
  sub: string;
  paused: boolean;
  step: string | null;
  onToggle: () => void;
  onCheckStep?: () => void;
}

/** What the floating window shows: time, the current step, and a pause button. Rendered into the PiP document. */
export function MiniTimer({ win, title, color, time, sub, paused, step, onToggle, onCheckStep }: MiniProps) {
  return createPortal(
    <div className="flex h-dvh flex-col justify-between bg-paper p-4 text-ink">
      <p className="flex items-center gap-2 truncate text-xs text-ink2">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color ?? "var(--ink-3)" }} />
        <span className="truncate">{title}</span>
      </p>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className={`num text-[2.8rem] font-extralight leading-none ${paused ? "focus-breathe" : ""}`} style={{ fontVariantNumeric: "tabular-nums" }}>
            {time}
          </p>
          <p className="mt-1 text-xs text-ink3">{sub}</p>
        </div>
        <button type="button" className="btn btn-primary !h-11 !w-11 shrink-0 !justify-center !rounded-full !px-0" onClick={onToggle} aria-label={paused ? "Resume" : "Pause"}>
          {paused ? <IconPlay /> : <IconPause />}
        </button>
      </div>
      {step ? (
        <button type="button" className="flex items-center gap-2 truncate text-left text-sm" onClick={onCheckStep} aria-label={`Check step: ${step}`}>
          <span className="check shrink-0 !cursor-pointer" aria-hidden>
            <InkCheck />
          </span>
          <span className="truncate">{step}</span>
        </button>
      ) : (
        <p className="text-sm text-ink3">&nbsp;</p>
      )}
    </div>,
    win.document.body,
  );
}

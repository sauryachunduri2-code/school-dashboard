"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconPause, IconPlay } from "@/components/icons";
import { elapsedMs, formatClock, formatOver, formatRemaining, isPaused, remainingMs } from "@/lib/focus";
import { useFocusActions, useOpenFocusSession, useTasks } from "@/lib/hooks";
import { useNow } from "./use-focus";

/**
 * "18:24 · Lab report": shown on every page except Focus while a session is open, so a timer started on the Mac is
 * visible (and pausable) from the phone. Taps through to the Focus page.
 */
export function FocusPill() {
  const path = usePathname();
  const open = useOpenFocusSession();
  const tasks = useTasks();
  const actions = useFocusActions();
  const paused = !!open && isPaused(open);
  const now = useNow(!!open && !paused, open ? +new Date(open.started_at) + open.paused_ms : 0);
  if (!open || path.startsWith("/focus")) return null;

  const rem = remainingMs(open, now);
  const over = rem != null && rem < 0;
  const time = rem == null ? formatClock(elapsedMs(open, now)) : over ? formatOver(-rem).replace(" over", "") : formatRemaining(rem);
  const isBreak = open.kind === "break";
  const title = isBreak ? "Break" : (open.title ?? tasks.find((t) => t.id === open.task_id)?.title ?? "Focus");
  const label = `${paused ? "Paused" : isBreak ? "Break" : "Focusing"}: ${title}, ${time}`;

  return (
    <div
      className="anim-pop fixed right-3 z-[41] flex max-w-[calc(100vw-1.5rem)] items-center rounded-full border border-rulestrong bg-paper/95 shadow-lift backdrop-blur bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-5 md:right-5"
    >
      <Link href="/focus" aria-label={`${label}. Open Focus`} className="flex min-w-0 items-center gap-2 py-2 pl-3.5 pr-2 text-sm">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${paused ? "border border-ink3" : isBreak ? "bg-ecs focus-pulse" : over ? "bg-margin" : "bg-accent focus-pulse"}`} />
        <span className="num shrink-0 font-medium">{time}</span>
        {!isBreak && <span className="min-w-0 max-w-[10rem] truncate text-ink2">· {title}</span>}
      </Link>
      <button
        type="button"
        className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink2 hover:bg-sheet2 hover:text-ink"
        aria-label={paused ? "Resume" : "Pause"}
        onClick={() => void (paused ? actions.resume(open) : actions.pause(open))}
      >
        {paused ? <IconPlay width={15} height={15} /> : <IconPause width={15} height={15} />}
      </button>
    </div>
  );
}

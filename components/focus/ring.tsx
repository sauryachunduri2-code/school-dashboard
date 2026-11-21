"use client";

import type { ReactNode } from "react";

export type RingTone = "work" | "break" | "over" | "idle";

const COLOR: Record<RingTone, string> = {
  work: "var(--accent)",
  break: "var(--ecs)",
  over: "var(--margin)",
  idle: "var(--ink-3)",
};

/**
 * The big timer: a thin progress ring with the time inside. Digits use tabular figures and the text scales with the ring
 * (container query units), so nothing shifts as the numbers tick. `children` goes under the digits (sub-label, overtime).
 */
export function TimerRing({
  fraction,
  tone,
  paused,
  time,
  top,
  children,
}: {
  fraction: number;
  tone: RingTone;
  paused: boolean;
  time: string;
  /** Small label above the digits ("Paused", "Break"). */
  top?: ReactNode;
  children?: ReactNode;
}) {
  const f = Math.min(1, Math.max(0, fraction));
  // Hours need more room: 1:02:11 is wider than 25:00.
  const size = time.length > 5 ? 15 : 21;
  return (
    <div className="relative mx-auto aspect-square" style={{ width: "min(100%, 46vh, 32rem)", containerType: "inline-size" }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <circle cx="50" cy="50" r="46" fill="none" stroke="var(--rule-strong)" strokeWidth="0.5" />
        <g style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%", opacity: paused ? 0.45 : 1, transition: "opacity 400ms" }}>
          <circle
            className="focus-arc"
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke={COLOR[tone]}
            strokeWidth="1.7"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={f >= 1 ? 0 : 1 - f}
            style={{ visibility: f <= 0 ? "hidden" : "visible" }}
          />
        </g>
        {/* the dot that rides the end of the arc */}
        <g className="focus-arc" style={{ transform: `rotate(${f * 360}deg)`, transformOrigin: "50% 50%", transitionProperty: "transform", opacity: paused ? 0.45 : 1 }}>
          <circle cx="50" cy="4" r="1.7" fill={COLOR[tone]} />
        </g>
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <p className="h-[3.2cqw] text-[2.6cqw] uppercase leading-none tracking-[0.22em] text-ink3">{top}</p>
        <p
          role="timer"
          aria-live="off"
          className={`num font-extralight leading-none tracking-tight ${paused ? "focus-breathe" : ""}`}
          style={{ fontSize: `${size}cqw`, fontVariantNumeric: "tabular-nums", marginTop: "1.2cqw" }}
        >
          {time}
        </p>
        <div className="mt-[2.4cqw] h-[8cqw] text-[3.4cqw] leading-tight text-ink2">{children}</div>
      </div>
    </div>
  );
}

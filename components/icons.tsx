import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const IconHome = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" /></svg>
);
export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
);
export const IconAreas = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 5h14M5 12h14M5 19h14" /><circle cx="3" cy="5" r=".6" /><circle cx="3" cy="12" r=".6" /><circle cx="3" cy="19" r=".6" /></svg>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></svg>
);
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></svg>
);
export const IconStar = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? "currentColor" : "none"}><path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8L9.6 9z" /></svg>
);
export const IconFlag = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? "currentColor" : "none"}><path d="M6 21V4M6 5h11l-2 4 2 4H6" /></svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMic = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6" /><path d="m20 20-4-4" /></svg>
);
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></svg>
);
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" /></svg>
);
export const IconChevron = ({ dir = "right", ...p }: SVGProps<SVGSVGElement> & { dir?: "left" | "right" | "down" }) => (
  <svg {...base(p)} style={{ transform: `rotate(${dir === "left" ? 180 : dir === "down" ? 90 : 0}deg)` }}><path d="m9 6 6 6-6 6" /></svg>
);
export const IconRepeat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 11V9a3 3 0 0 1 3-3h11M15 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H6M9 21l-3-3 3-3" /></svg>
);
export const IconBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15zM10 21h4" /></svg>
);
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></svg>
);
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>
);
export const IconLock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);

export function InkCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}
export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);

// Focus page
export const IconFocus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /></svg>
);
export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 5.5v13l10.5-6.5z" /></svg>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 5.5v13M15 5.5v13" strokeWidth={2.4} /></svg>
);
export const IconCoffee = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5v2M12 3.5v2" /></svg>
);
export const IconFullscreen = ({ exit, ...p }: SVGProps<SVGSVGElement> & { exit?: boolean }) => (
  <svg {...base(p)}>{exit ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
);
export const IconPip = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3.5" y="5" width="17" height="14" rx="2" /><rect x="11.5" y="11.5" width="7" height="5" rx="1" fill="currentColor" stroke="none" /></svg>
);
export const IconBellOff = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 17V11a6 6 0 0 1 9.5-4.9M18 11v6l1.5 2H8M10 21h4M4 4l16 16" /></svg>
);
export const IconSkip = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l8 6-8 6zM18 6v12" /></svg>
);

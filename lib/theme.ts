// Theme modes and the "scheduled" rule: Paper from one clock time, Lamplight from another.
// Stored per device in localStorage, like the rest of the theme choice.

export type ThemeMode = "system" | "light" | "dark" | "schedule";
export type Schedule = { light: string; dark: string }; // "HH:MM", 24-hour

export const THEME_KEY = "sd-theme";
export const SCHEDULE_KEY = "sd-theme-schedule";
export const DEFAULT_SCHEDULE: Schedule = { light: "07:00", dark: "20:00" };

/** Address-bar / title-bar colour for each palette (matches --paper). */
export const THEME_COLOR = { light: "#efeadc", dark: "#1b1612" } as const;

const HHMM = /^(\d{1,2}):(\d{2})$/;

function minutes(v: string | undefined, fallback: string): number {
  const m = HHMM.exec(v ?? "") ?? HHMM.exec(fallback)!;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

export function parseSchedule(raw: string | null): Schedule {
  try {
    const s = raw ? (JSON.parse(raw) as Partial<Schedule>) : {};
    return {
      light: typeof s.light === "string" && HHMM.test(s.light) ? s.light : DEFAULT_SCHEDULE.light,
      dark: typeof s.dark === "string" && HHMM.test(s.dark) ? s.dark : DEFAULT_SCHEDULE.dark,
    };
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

/** Which palette the schedule asks for at `now`. Handles Lamplight starting after midnight too. */
export function scheduledTheme(now: Date, s: Schedule): "light" | "dark" {
  const l = minutes(s.light, DEFAULT_SCHEDULE.light);
  const d = minutes(s.dark, DEFAULT_SCHEDULE.dark);
  const c = now.getHours() * 60 + now.getMinutes();
  if (l === d) return "light";
  const isLight = l < d ? c >= l && c < d : c >= l || c < d;
  return isLight ? "light" : "dark";
}

/** The next time the schedule flips, so the page can switch while it's open. */
export function nextSwitch(now: Date, s: Schedule): Date {
  const times = [s.light, s.dark].map((t) => {
    const m = minutes(t, DEFAULT_SCHEDULE.light);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(m / 60), m % 60);
    if (at <= now) at.setDate(at.getDate() + 1);
    return at;
  });
  return times[0] < times[1] ? times[0] : times[1];
}

// Runs in <head> before first paint so the right palette never flashes. Mirrors scheduledTheme();
// tests/theme.test.ts runs this exact string to keep the two in step.
export const THEME_BOOT_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem('${THEME_KEY}');if(t==='schedule'){var s={};try{s=JSON.parse(localStorage.getItem('${SCHEDULE_KEY}')||'{}')||{}}catch(e){}var r=/^(\\d{1,2}):(\\d{2})$/,p=function(v,f){var m=r.exec(typeof v==='string'?v:'')||r.exec(f);return Math.min(23,+m[1])*60+Math.min(59,+m[2])},l=p(s.light,'${DEFAULT_SCHEDULE.light}'),k=p(s.dark,'${DEFAULT_SCHEDULE.dark}'),n=new Date(),c=n.getHours()*60+n.getMinutes();t=l===k||(l<k?c>=l&&c<k:c>=l||c<k)?'light':'dark'}if(t==='light'||t==='dark')d.setAttribute('data-theme',t)}catch(e){}`;

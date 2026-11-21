/** Time-zone maths for the brief without a tz library: the server runs in UTC, the morning happens in the owner's zone. */

export function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const get = (t: string) => Number(f.formatToParts(d).find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Local wall-clock minus UTC, in ms, at instant `d`. */
function offsetMs(d: Date, tz: string): number {
  const p = parts(d, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000;
}

/** YYYY-MM-DD of instant `d` in `tz`. */
export function zonedYmd(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** The instant of local midnight starting day `ymd` in `tz` (DST-safe: re-checks the offset at the guess). */
export function zonedMidnight(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess), tz);
  const again = guess - offsetMs(new Date(t), tz);
  if (again !== t) t = again;
  return new Date(t);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** [start of day, start of next day) for `ymd` in `tz`. */
export function dayBounds(ymd: string, tz: string): { from: Date; to: Date } {
  return { from: zonedMidnight(ymd, tz), to: zonedMidnight(addDaysYmd(ymd, 1), tz) };
}

export function clock(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
}

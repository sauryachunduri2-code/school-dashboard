import type { HoursLog, List } from "./types";

const esc = (v: string | number) => {
  const s = String(v);
  // Quote fields with commas, quotes or newlines; neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function hoursToCsv(logs: HoursLog[], lists: List[]): string {
  const rows = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const lines = [["Date", "EC", "Area", "Hours", "Note"].join(",")];
  for (const l of rows) {
    const list = lists.find((x) => x.id === l.list_id);
    lines.push([l.date, list?.name ?? "", list?.area ?? "", l.hours, l.note].map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}

export interface HoursTotals {
  all: number;
  month: number;
  week: number;
}

export function totalsFor(logs: HoursLog[], monthPrefix: string, weekStart: string, weekEnd: string): HoursTotals {
  const sum = (xs: HoursLog[]) => Math.round(xs.reduce((s, l) => s + l.hours, 0) * 100) / 100;
  return {
    all: sum(logs),
    month: sum(logs.filter((l) => l.date.startsWith(monthPrefix))),
    week: sum(logs.filter((l) => l.date >= weekStart && l.date < weekEnd)),
  };
}

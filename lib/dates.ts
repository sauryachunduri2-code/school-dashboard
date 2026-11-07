import {
  addDays,
  endOfDay,
  format,
  isSameDay,
  startOfDay,
  startOfWeek,
} from "date-fns";

export { addDays, endOfDay, format, isSameDay, startOfDay, startOfWeek };

export const WEEK_STARTS_ON = 0 as const; // Sunday, like Apple Calendar in the US

export const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** Parse YYYY-MM-DD as a local date (not UTC). */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first, { weekStartsOn: WEEK_STARTS_ON });
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const total = Math.ceil(((+last - +start) / 86400000 + 1) / 7) * 7;
  return Array.from({ length: total }, (_, i) => addDays(start, i));
}

export function formatTime(d: Date): string {
  return d.getMinutes() === 0 ? format(d, "h a").toLowerCase() : format(d, "h:mm a").toLowerCase();
}

export function dayLabel(d: Date, now = new Date()): string {
  const diff = Math.round((+startOfDay(d) - +startOfDay(now)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return format(d, "EEEE");
}

export function daysUntil(d: Date, now = new Date()): number {
  return Math.round((+startOfDay(d) - +startOfDay(now)) / 86400000);
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

import type { BriefFacts, BriefItem, Prose } from "./types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const when = (i: BriefItem) => (i.daysAway === 1 ? "tomorrow" : `in ${i.daysAway} days`);

/** The brief without Gemini: always available, and what Gemini's answer falls back to. */
export function ruleProse(f: BriefFacts): Prose {
  const events = f.today.filter((i) => i.kind === "event").length;
  const tasks = f.today.filter((i) => i.kind === "task").length;

  const headline = f.next
    ? `First up: ${f.next.title} at ${f.next.time}`
    : f.today.length === 0
      ? `Nothing scheduled this ${f.weekday}`
      : `${plural(f.today.length, "thing")} on today`;

  const parts: string[] = [];
  if (events || tasks) {
    parts.push(`${f.weekday}: ${[events && plural(events, "event"), tasks && plural(tasks, "task")].filter(Boolean).join(" and ")} today.`);
  } else {
    parts.push(`Your ${f.weekday} is open.`);
  }
  if (f.overdue.length) parts.push(`${plural(f.overdue.length, "overdue task")}, starting with ${f.overdue[0].title}.`);
  if (f.upcoming.length) parts.push(`Coming up: ${f.upcoming[0].title} ${when(f.upcoming[0])}.`);

  const firstTask = f.overdue[0] ?? f.today.find((i) => i.kind === "task") ?? null;
  const block = f.free[0];
  const focus = firstTask && block
    ? `You're free ${block.time}–${block.endTime}: a good time for ${firstTask.title}.`
    : firstTask
      ? `Get ${firstTask.title} out of the way first.`
      : null;

  return { headline, summary: parts.join(" "), focus };
}

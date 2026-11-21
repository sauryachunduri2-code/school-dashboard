import { normalizeDictation } from "./dictation";
import { parseQuickAdd, type Parsed } from "./quickadd";
import type { List, Task } from "./types";

/** One item of a brain dump: the text for the quick-add parser, plus its checklist. */
export interface DumpItem {
  line: string;
  steps: string[];
}
export interface ParsedDumpItem {
  /** The piece as the parser saw it (after dictation normalizing, if any). */
  source: string;
  parsed: Parsed;
  steps: string[];
}

/** Words before a period that don't end a sentence ("Dec. 5", "9 a.m. call", "ch. 3"). */
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "st",
  "prof",
  "jr",
  "sr",
  "vs",
  "etc",
  "mt",
  "ft",
  "no",
  "ch",
  "pp",
  "p",
  "approx",
  "e.g",
  "i.e",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
]);

/** A leading "* " is not a bullet: in quick-add a lone `*` stars the task. */
const BULLET_RE = /^\s*(?:[-•]|\d+[.)])\s+/;
/** Indented bullet (or a `>` quote) under a task: one of its steps. */
const SUBSTEP_RE = /^(?:[ \t]+[-*•]|\s*>)\s+/;
/** "steps: a, b, c" / "with steps a, b and c" at the end of a piece (a bare "steps a, b" is too ambiguous). */
const STEPS_TAIL_RE = /(?:[\s,;]+with\s+steps?:?\s+|[\s,;]*\bsteps?:\s*)(.+)$/i;
const STEPS_PIECE_RE = /^(?:with\s+)?steps?:\s*/i;
const CONNECTOR_RE = /[\s,]+(?:and\s+then|and\s+also|then|also)\s+/i;

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:]+|[\s,;]+$/g, "")
    .replace(/(\w{3,})\.$/, "$1")
    .trim();

/** Split on `;` and on sentence-ending periods, but not on abbreviations, decimals, dates or times. */
function splitSentences(line: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (const m of line.matchAll(/(\S*)(\.)\s+(?=[A-Za-z])|;\s*/g)) {
    if (m[2]) {
      const word = (m[1] ?? "").toLowerCase();
      // "a.m." / "p.m." / "e.g." leave a dotted word behind
      if (ABBREVIATIONS.has(word) || /^(?:[a-z]\.)+[a-z]$/.test(word)) continue;
    }
    out.push(line.slice(from, m[2] ? m.index! + m[1].length : m.index));
    from = m.index! + m[0].length;
  }
  out.push(line.slice(from));
  return out;
}

function splitList(s: string): string[] {
  return s
    .split(/\s*,\s*|\s+and\s+/i)
    .map((x) => clean(x.replace(/^and\s+/i, "")))
    .filter(Boolean);
}

/**
 * Turns a messy list into separate items. Newlines split; so do `;`, sentence periods and "and then" / "then" /
 * "also" within a line. Indented `-` lines (and the spoken "steps: a, b, c") become the previous item's steps.
 * It under-splits on purpose: "from 3 to 4", "remind 1 hour before", "Dec. 5" and "9:30" stay intact.
 */
export function splitBrainDump(text: string): DumpItem[] {
  const items: DumpItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const last = items[items.length - 1];
    if (last && SUBSTEP_RE.test(raw)) {
      const step = clean(raw.replace(SUBSTEP_RE, ""));
      if (step) last.steps.push(step);
      continue;
    }
    const line = raw.replace(BULLET_RE, "");
    for (const sentence of splitSentences(line)) {
      for (const piece of sentence.split(CONNECTOR_RE)) {
        let body = clean(piece.replace(/^(?:and\s+)?(?:then|also)\s+/i, ""));
        if (!body) continue;
        const prev = items[items.length - 1];
        // "steps: a, b" after a sentence break belongs to the item before it
        if (prev && STEPS_PIECE_RE.test(body)) {
          prev.steps.push(...splitList(body.replace(STEPS_PIECE_RE, "")));
          continue;
        }
        const steps: string[] = [];
        const tail = body.match(STEPS_TAIL_RE);
        if (tail && tail.index! > 0) {
          steps.push(...splitList(tail[1]));
          body = clean(body.slice(0, tail.index));
        }
        if (body) items.push({ line: body, steps });
      }
    }
  }
  return items;
}

/**
 * Splits, then parses each item with the quick-add parser. `dictated` runs the speech normalizer first
 * ("due Friday at nine p.m." to quick-add syntax); leave it off for typed text, which is already in that syntax.
 * Pieces that parse to nothing are dropped.
 */
export function parseBrainDump(
  text: string,
  lists: List[],
  now: Date = new Date(),
  opts: { dictated?: boolean } = {},
): ParsedDumpItem[] {
  const out: ParsedDumpItem[] = [];
  for (const { line, steps } of splitBrainDump(text)) {
    const source = opts.dictated ? normalizeDictation(line, lists, now) : line;
    const parsed = parseQuickAdd(source, lists, now);
    if (parsed.kind !== "empty") out.push({ source, parsed, steps });
  }
  return out;
}

/** Rebuilds editable text from items (one line each, steps as indented bullets), the inverse of splitBrainDump. */
export const dumpToText = (items: DumpItem[]): string =>
  items
    .map((it) => [it.line, ...it.steps.map((s) => `  - ${s}`)].join("\n"))
    .join("\n");

/** The Inbox: open tasks with no list and no date, newest first. */
export const inboxTasks = (tasks: Task[]): Task[] =>
  tasks
    .filter((t) => !t.completed_at && t.list_id == null && t.due_at == null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

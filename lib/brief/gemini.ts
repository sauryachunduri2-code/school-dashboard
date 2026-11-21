import type { BriefFacts, Prose } from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GeminiOptions {
  apiKey: string;
  /** Default `DEFAULT_MODEL`; override with GEMINI_MODEL */
  model?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export const DEFAULT_MODEL = "gemini-3.8-flash";

const LIMITS = { headline: 70, summary: 360, focus: 160 };

const SYSTEM = `You write the morning brief a student reads right after getting out of bed.
Use only the facts in the JSON you are given. Never invent events, tasks, times or people, and never change a time.
"today" is everything on the student's day, "next" is the next timed thing, "overdue" are late tasks, "upcoming" are starred or flagged items in the next week (daysAway counts days), "free" are open gaps today.
Write in the second person, warm and direct, no emojis, no greeting like "Good morning" (the app adds it).
headline: at most 60 characters, the single most important thing about today.
summary: 2 or 3 short sentences covering the shape of the day, with times as written in the facts.
focus: one concrete suggestion, for example which overdue or due-today task to do in which free gap; null if there is nothing useful to suggest.
Answer with only a JSON object: {"headline": string, "summary": string, "focus": string or null}.`;

/** Only what the brief needs: titles, times and list names. Task notes and event descriptions never leave Daybook. */
export function promptFacts(f: BriefFacts) {
  const slim = (i: BriefFacts["today"][number]) => ({
    kind: i.kind, title: i.title, allDay: i.allDay, time: i.time, endTime: i.endTime, list: i.list,
    starred: i.starred || undefined, flagged: i.flagged || undefined, daysAway: i.daysAway,
  });
  return {
    date: f.date, weekday: f.weekday, nowTime: f.nowTime,
    today: f.today.map(slim), next: f.next && slim(f.next), overdue: f.overdue.map(slim), upcoming: f.upcoming.map(slim),
    free: f.free.map((b) => ({ time: b.time, endTime: b.endTime, minutes: b.minutes })),
  };
}

const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Checks Gemini's JSON and trims it to size. Throws on anything that isn't the expected shape. */
export function parseProse(text: string): Prose {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const raw = JSON.parse(unfenced) as Record<string, unknown>;
  const headline = typeof raw.headline === "string" ? raw.headline.trim() : "";
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (!headline || !summary) throw new Error("gemini: missing headline or summary");
  const focus = typeof raw.focus === "string" && raw.focus.trim() ? clamp(raw.focus.trim(), LIMITS.focus) : null;
  return { headline: clamp(headline, LIMITS.headline), summary: clamp(summary, LIMITS.summary), focus };
}

export async function geminiProse(facts: BriefFacts, opts: GeminiOptions): Promise<Prose> {
  const f = opts.fetch ?? (fetch as FetchLike);
  const model = opts.model || DEFAULT_MODEL;
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(promptFacts(facts)) }] }],
      // Plain JSON mode: the shape is in the system prompt and checked by parseProse, which works across API revisions.
      generationConfig: { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens: 2048 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 9000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return parseProse(text);
}

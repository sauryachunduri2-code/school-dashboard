import { buildFacts, type FactsInput } from "./facts";
import { geminiProse } from "./gemini";
import { ruleProse } from "./rules";
import type { CalendarStatus, MorningBrief, Prose } from "./types";

export interface BriefDeps extends FactsInput {
  calendar: CalendarStatus;
  /** Writes the prose with an LLM. Absent (no GEMINI_API_KEY) or failing: the rule-based prose is used. */
  writer?: (facts: ReturnType<typeof buildFacts>) => Promise<Prose>;
  log?: (message: string) => void;
}

export async function makeBrief(d: BriefDeps): Promise<MorningBrief> {
  const facts = buildFacts(d);
  let prose = ruleProse(facts);
  let source: MorningBrief["source"] = "rules";
  if (d.writer) {
    try {
      prose = await d.writer(facts);
      source = "gemini";
    } catch (e) {
      d.log?.(`brief: gemini failed, using rules (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return {
    ...prose,
    date: facts.date,
    generatedAt: d.now.toISOString(),
    source,
    next: facts.next,
    today: facts.today,
    overdue: facts.overdue,
    upcoming: facts.upcoming,
    calendar: d.calendar,
  };
}

export function geminiWriter(env: NodeJS.ProcessEnv = process.env): BriefDeps["writer"] {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  return (facts) => geminiProse(facts, { apiKey, model: env.GEMINI_MODEL });
}

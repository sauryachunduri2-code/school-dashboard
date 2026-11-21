import { describe, expect, it } from "vitest";
import {
  dumpToText,
  inboxTasks,
  parseBrainDump,
  splitBrainDump,
} from "@/lib/braindump";
import type { ParsedEvent, ParsedTask } from "@/lib/quickadd";
import { SEED_LISTS } from "@/lib/seed";
import type { Task } from "@/lib/types";

// Friday, Nov 6 2026, noon local
const NOW = new Date(2026, 10, 6, 12, 0);
const L = SEED_LISTS;
const lines = (s: string) => splitBrainDump(s).map((i) => i.line);

describe("splitBrainDump: lines", () => {
  it("empty and blank input", () => {
    expect(splitBrainDump("")).toEqual([]);
    expect(splitBrainDump("  \n\n \t\n")).toEqual([]);
  });
  it("one line stays one item", () => {
    expect(splitBrainDump("buy poster board")).toEqual([
      { line: "buy poster board", steps: [] },
    ]);
  });
  it("splits on newlines, handling CRLF", () => {
    expect(lines("email Ms. Lee\r\nbuy milk\n\ncall mom")).toEqual([
      "email Ms. Lee",
      "buy milk",
      "call mom",
    ]);
  });
  it("keeps a leading * (the star token), not a bullet", () => {
    const [item] = parseBrainDump("* SAT practice test\nread ch 3", [], new Date(2026, 10, 19, 14));
    expect(item.parsed.kind === "task" && item.parsed.starred).toBe(true);
  });
  it("strips bullets and numbering", () => {
    expect(lines("- one\n* two\n• three\n1. four\n2) five")).toEqual([
      "one",
      "* two",
      "three",
      "four",
      "five",
    ]);
  });
  it("keeps a leading time that looks like numbering", () => {
    expect(lines("3pm call mom")).toEqual(["3pm call mom"]);
  });
});

describe("splitBrainDump: connectors", () => {
  it("splits on 'and then', 'then' and 'also'", () => {
    expect(lines("buy milk and then email bob")).toEqual([
      "buy milk",
      "email bob",
    ]);
    expect(lines("buy milk, then email bob")).toEqual([
      "buy milk",
      "email bob",
    ]);
    expect(lines("buy milk also email bob")).toEqual(["buy milk", "email bob"]);
    expect(lines("buy milk and also email bob")).toEqual([
      "buy milk",
      "email bob",
    ]);
  });
  it("splits on semicolons and sentence periods", () => {
    expect(lines("buy milk; email bob")).toEqual(["buy milk", "email bob"]);
    expect(lines("buy milk. Email bob. Call mom.")).toEqual([
      "buy milk",
      "Email bob",
      "Call mom",
    ]);
  });
  it("drops a leading connector", () => {
    expect(lines("also buy milk")).toEqual(["buy milk"]);
  });
  it("does not split plain 'and'", () => {
    expect(lines("salt and pepper")).toEqual(["salt and pepper"]);
  });
  it("leaves things the parser needs alone", () => {
    for (const s of [
      "hosa mtg thu from 3 to 4pm",
      "essay due fri remind 1 hour before",
      "poster due Dec. 5",
      "call at 9:30",
      "meeting 9 a.m. tomorrow",
      "read ch. 3 tonight",
      "run 1.5 miles",
      "email Dr. Kim",
    ]) {
      expect(lines(s)).toEqual([s]);
    }
  });
  it("splits a spoken run-on list", () => {
    expect(
      lines("essay due friday and then buy poster board also call mom"),
    ).toEqual(["essay due friday", "buy poster board", "call mom"]);
  });
});

describe("splitBrainDump: steps", () => {
  it("indented bullets become steps of the previous item", () => {
    expect(
      splitBrainDump("write essay\n  - outline\n  - draft\nbuy milk\n\t- oat"),
    ).toEqual([
      { line: "write essay", steps: ["outline", "draft"] },
      { line: "buy milk", steps: ["oat"] },
    ]);
  });
  it("'>' lines are steps too", () => {
    expect(splitBrainDump("trip\n> book\n> pack")).toEqual([
      { line: "trip", steps: ["book", "pack"] },
    ]);
  });
  it("a bullet with no task above it is a task", () => {
    expect(splitBrainDump("  - orphan")).toEqual([
      { line: "orphan", steps: [] },
    ]);
  });
  it("unindented bullets are tasks, not steps", () => {
    expect(lines("write essay\n- outline")).toEqual(["write essay", "outline"]);
  });
  it("'steps: a, b, c' at the end of a line", () => {
    expect(splitBrainDump("write essay steps: outline, draft, edit")).toEqual([
      { line: "write essay", steps: ["outline", "draft", "edit"] },
    ]);
  });
  it("'with steps a, b and c'", () => {
    expect(
      splitBrainDump("write essay with steps outline, draft and edit"),
    ).toEqual([{ line: "write essay", steps: ["outline", "draft", "edit"] }]);
  });
  it("a steps sentence after a period attaches to the item before", () => {
    expect(
      splitBrainDump("write essay. Steps: outline, draft. Buy milk"),
    ).toEqual([
      { line: "write essay", steps: ["outline", "draft"] },
      { line: "Buy milk", steps: [] },
    ]);
  });
  it("the word 'steps' inside a title is left alone", () => {
    expect(lines("count steps today")).toEqual(["count steps today"]);
  });
});

describe("parseBrainDump", () => {
  const hosa = L.find((l) => l.name === "HOSA")!;
  it("parses each item as a task, event or hours entry", () => {
    const r = parseBrainDump(
      "essay due fri #hosa\nhosa mtg thu 3-4pm\nlog 2h hosa poster\nbuy milk",
      L,
      NOW,
    );
    expect(r.map((x) => x.parsed.kind)).toEqual([
      "task",
      "event",
      "hours",
      "task",
    ]);
    expect((r[0].parsed as ParsedTask).listId).toBe(hosa.id);
    expect((r[3].parsed as ParsedTask).due).toBeNull();
  });
  it("carries steps through", () => {
    const r = parseBrainDump("write essay\n  - outline\n  - draft", L, NOW);
    expect(r).toHaveLength(1);
    expect(r[0].steps).toEqual(["outline", "draft"]);
  });
  it("typed syntax is untouched unless dictated", () => {
    expect(
      parseBrainDump("essay due fri #hosa remind 1h", L, NOW)[0].source,
    ).toBe("essay due fri #hosa remind 1h");
  });
  it("dictated text is normalized per item", () => {
    const r = parseBrainDump(
      "HOSA meeting Thursday from three to four p.m. and then buy poster board",
      L,
      NOW,
      { dictated: true },
    );
    expect(r).toHaveLength(2);
    expect(r[0].parsed.kind).toBe("event");
    const e = r[0].parsed as ParsedEvent;
    expect([e.start.getHours(), e.end.getHours()]).toEqual([15, 16]);
    expect(r[1].parsed.kind).toBe("task");
  });
  it("dictated sentences become separate items", () => {
    const r = parseBrainDump("Buy milk. Call mom tomorrow.", L, NOW, {
      dictated: true,
    });
    expect(r.map((x) => (x.parsed as ParsedTask).title)).toEqual([
      "Buy milk",
      "Call mom",
    ]);
  });
  it("drops pieces that parse to nothing", () => {
    expect(parseBrainDump("\n \n", L, NOW)).toEqual([]);
  });
});

describe("dumpToText", () => {
  it("round-trips through splitBrainDump", () => {
    const items = [
      { line: "write essay", steps: ["outline", "draft"] },
      { line: "buy milk", steps: [] },
    ];
    expect(splitBrainDump(dumpToText(items))).toEqual(items);
  });
});

describe("inboxTasks", () => {
  const t = (over: Partial<Task>): Task =>
    ({
      id: "x",
      title: "t",
      notes: "",
      list_id: null,
      due_at: null,
      all_day: true,
      remind_default: true,
      reminders: [],
      rrule: null,
      starred: false,
      flagged: false,
      completed_at: null,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-01T00:00:00Z",
      ...over,
    }) as Task;
  it("keeps open tasks with no list and no date", () => {
    const got = inboxTasks([
      t({ id: "in" }),
      t({ id: "listed", list_id: "l1" }),
      t({ id: "dated", due_at: "2026-11-08T00:00:00Z" }),
      t({ id: "done", completed_at: "2026-11-02T00:00:00Z" }),
    ]);
    expect(got.map((x) => x.id)).toEqual(["in"]);
  });
  it("lists the newest first", () => {
    const got = inboxTasks([
      t({ id: "old" }),
      t({ id: "new", created_at: "2026-11-05T00:00:00Z" }),
    ]);
    expect(got.map((x) => x.id)).toEqual(["new", "old"]);
  });
});

import { describe, expect, it } from "vitest";
import { currentStep, moveStep, newStep, removeStep, renameStep, stepProgress, stepsOf, toggleStep } from "@/lib/steps";
import type { TaskStep } from "@/lib/types";

const mk = (...specs: [string, boolean?][]): TaskStep[] => specs.map(([title, done]) => ({ id: `id-${title}`, title, done: !!done }));
const titles = (s: TaskStep[]) => s.map((x) => x.title);

describe("stepsOf", () => {
  it("is empty for tasks saved before steps existed", () => {
    expect(stepsOf({})).toEqual([]);
    expect(stepsOf({ steps: undefined })).toEqual([]);
  });
  it("returns the stored steps", () => {
    const steps = mk(["a"]);
    expect(stepsOf({ steps })).toBe(steps);
  });
});

describe("newStep", () => {
  it("trims and starts undone with an id", () => {
    const s = newStep("  read ch. 4  ");
    expect(s.title).toBe("read ch. 4");
    expect(s.done).toBe(false);
    expect(s.id).toBeTruthy();
  });
  it("gives distinct ids", () => {
    expect(newStep("a").id).not.toBe(newStep("a").id);
  });
});

describe("stepProgress", () => {
  it("counts done and total", () => {
    expect(stepProgress({ steps: mk(["a", true], ["b"], ["c", true]) })).toEqual({ done: 2, total: 3 });
  });
  it("is 0/0 without steps", () => {
    expect(stepProgress({})).toEqual({ done: 0, total: 0 });
  });
});

describe("currentStep", () => {
  it("is the first undone step", () => {
    expect(currentStep({ steps: mk(["a", true], ["b"], ["c"]) })?.title).toBe("b");
  });
  it("is null when all done or none", () => {
    expect(currentStep({ steps: mk(["a", true]) })).toBeNull();
    expect(currentStep({})).toBeNull();
  });
});

describe("toggleStep / renameStep / removeStep", () => {
  const steps = mk(["a"], ["b", true]);
  it("toggles one step without mutating", () => {
    const out = toggleStep(steps, "id-a");
    expect(out.map((s) => s.done)).toEqual([true, true]);
    expect(steps[0].done).toBe(false);
    expect(toggleStep(steps, "id-b")[1].done).toBe(false);
  });
  it("renames one step", () => {
    expect(titles(renameStep(steps, "id-b", "z"))).toEqual(["a", "z"]);
  });
  it("removes one step", () => {
    expect(titles(removeStep(steps, "id-a"))).toEqual(["b"]);
  });
  it("ignores unknown ids", () => {
    expect(toggleStep(steps, "nope")).toEqual(steps);
    expect(renameStep(steps, "nope", "x")).toEqual(steps);
    expect(removeStep(steps, "nope")).toEqual(steps);
  });
});

describe("moveStep", () => {
  const steps = mk(["a"], ["b"], ["c"]);
  it("moves up and down", () => {
    expect(titles(moveStep(steps, "id-b", -1))).toEqual(["b", "a", "c"]);
    expect(titles(moveStep(steps, "id-b", 1))).toEqual(["a", "c", "b"]);
  });
  it("ignores out-of-range moves and unknown ids", () => {
    expect(moveStep(steps, "id-a", -1)).toBe(steps);
    expect(moveStep(steps, "id-c", 1)).toBe(steps);
    expect(moveStep(steps, "nope", 1)).toBe(steps);
  });
  it("does not mutate", () => {
    moveStep(steps, "id-a", 1);
    expect(titles(steps)).toEqual(["a", "b", "c"]);
  });
});

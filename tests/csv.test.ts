import { describe, expect, it } from "vitest";
import { hoursToCsv, totalsFor } from "@/lib/csv";
import { SEED_LISTS } from "@/lib/seed";
import type { HoursLog } from "@/lib/types";

const log = (date: string, hours: number, list: number, note = ""): HoursLog => ({ id: date + hours, date, hours, note, list_id: SEED_LISTS[list].id, created_at: "" });

describe("hours csv + totals", () => {
  it("exports sorted rows with list and area names", () => {
    const csv = hoursToCsv([log("2026-11-05", 1.5, 1, "poster"), log("2026-11-01", 2, 2)], SEED_LISTS);
    expect(csv.split("\n")).toEqual(["Date,EC,Area,Hours,Note", "2026-11-01,Remember Together,ecs,2,", "2026-11-05,HOSA,ecs,1.5,poster", ""]);
  });
  it("escapes commas, quotes and formula injection", () => {
    const csv = hoursToCsv([log("2026-11-01", 1, 1, 'say "hi", ok'), log("2026-11-02", 1, 1, "=SUM(A1)")], SEED_LISTS);
    expect(csv).toContain('"say ""hi"", ok"');
    expect(csv).toContain("'=SUM(A1)");
  });
  it("totals by week, month and all-time", () => {
    const logs = [log("2026-11-02", 1, 1), log("2026-11-08", 2, 1), log("2026-10-30", 4, 1)];
    expect(totalsFor(logs, "2026-11", "2026-11-01", "2026-11-08")).toEqual({ all: 7, month: 3, week: 1 });
  });
});

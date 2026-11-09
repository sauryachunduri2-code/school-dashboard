import { describe, expect, it } from "vitest";
import { THEME_BOOT_SCRIPT, nextSwitch, parseSchedule, scheduledTheme } from "@/lib/theme";

const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m);
const day = { light: "07:00", dark: "20:00" };

describe("scheduled theme", () => {
  it("is Paper between the two times and Lamplight outside them", () => {
    expect(scheduledTheme(at(6, 59), day)).toBe("dark");
    expect(scheduledTheme(at(7, 0), day)).toBe("light");
    expect(scheduledTheme(at(13), day)).toBe("light");
    expect(scheduledTheme(at(19, 59), day)).toBe("light");
    expect(scheduledTheme(at(20, 0), day)).toBe("dark");
    expect(scheduledTheme(at(0, 30), day)).toBe("dark");
  });

  it("handles Lamplight starting after midnight", () => {
    const late = { light: "06:30", dark: "01:00" };
    expect(scheduledTheme(at(23), late)).toBe("light");
    expect(scheduledTheme(at(0, 59), late)).toBe("light");
    expect(scheduledTheme(at(1, 0), late)).toBe("dark");
    expect(scheduledTheme(at(6, 30), late)).toBe("light");
  });

  it("falls back to defaults for missing or broken saved values", () => {
    expect(parseSchedule(null)).toEqual({ light: "07:00", dark: "20:00" });
    expect(parseSchedule("not json")).toEqual({ light: "07:00", dark: "20:00" });
    expect(parseSchedule('{"light":"8:15","dark":"bad"}')).toEqual({ light: "8:15", dark: "20:00" });
  });

  it("finds the next flip, rolling to tomorrow", () => {
    expect(nextSwitch(at(13), day)).toEqual(at(20));
    expect(nextSwitch(at(5), day)).toEqual(at(7));
    expect(nextSwitch(at(21), day)).toEqual(new Date(2026, 10, 10, 7, 0));
    expect(nextSwitch(at(20), day)).toEqual(new Date(2026, 10, 10, 7, 0));
  });
});

// Runs the real <head> script against a fake page and checks it agrees with scheduledTheme().
function boot(store: Record<string, string>, now: Date): string | null {
  let theme: string | null = null;
  const document = { documentElement: { setAttribute: (_: string, v: string) => (theme = v) } };
  const localStorage = { getItem: (k: string) => store[k] ?? null };
  const RealDate = Date;
  const FakeDate = function (this: unknown) {
    return new RealDate(now);
  } as unknown as DateConstructor;
  new Function("document", "localStorage", "Date", THEME_BOOT_SCRIPT)(document, localStorage, FakeDate);
  return theme;
}

describe("theme boot script", () => {
  it("applies a fixed choice and leaves Match device alone", () => {
    expect(boot({ "sd-theme": "dark" }, at(12))).toBe("dark");
    expect(boot({ "sd-theme": "light" }, at(23))).toBe("light");
    expect(boot({}, at(12))).toBeNull();
  });

  it("matches scheduledTheme for every half hour, including a past-midnight schedule", () => {
    for (const s of [day, { light: "06:30", dark: "01:00" }]) {
      for (let i = 0; i < 48; i++) {
        const now = at(Math.floor(i / 2), (i % 2) * 30);
        expect(boot({ "sd-theme": "schedule", "sd-theme-schedule": JSON.stringify(s) }, now)).toBe(scheduledTheme(now, s));
      }
    }
  });

  it("uses the default times when the saved schedule is broken", () => {
    expect(boot({ "sd-theme": "schedule", "sd-theme-schedule": "{oops" }, at(21))).toBe("dark");
    expect(boot({ "sd-theme": "schedule" }, at(9))).toBe("light");
  });
});

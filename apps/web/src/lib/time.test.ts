import { describe, expect, it } from "vitest";
import { formatWhen } from "./time";

/** English source strings, so the test needs no provider. */
const t = (message: string, vars?: Record<string, string | number>) => {
  let text = message;
  for (const [name, value] of Object.entries(vars ?? {})) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
};

describe("formatWhen", () => {
  it("reads like a message label in English", () => {
    expect(formatWhen("2026-10-15T20:23:00.000Z", "en", t, "UTC")).toBe("Thu, Oct 15 at 8:23 PM");
  });

  it("uses the moment's own weekday and day, not today's", () => {
    expect(formatWhen("2026-01-01T09:05:00.000Z", "en", t, "UTC")).toBe("Thu, Jan 1 at 9:05 AM");
  });

  it("localises through the translation for Chinese", () => {
    const zh = formatWhen(
      "2026-10-15T20:23:00.000Z",
      "zh",
      (message, vars) => {
        const pattern = message === "{date} at {time}" ? "{date} {time}" : message;
        return pattern
          .split("{date}")
          .join(String(vars?.date ?? ""))
          .split("{time}")
          .join(String(vars?.time ?? ""));
      },
      "UTC",
    );
    expect(zh).toContain("10月15日");
    expect(zh).toContain("20:23");
    expect(zh).not.toContain(" at ");
  });

  it("is empty for a missing or invalid stamp rather than printing nonsense", () => {
    expect(formatWhen(undefined, "en", t)).toBe("");
    expect(formatWhen("", "en", t)).toBe("");
    expect(formatWhen("not a date", "en", t)).toBe("");
  });
});

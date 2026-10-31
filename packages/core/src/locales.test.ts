import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, resolveLocale } from "./locales.js";

describe("isLocale", () => {
  it("accepts the supported languages", () => {
    for (const locale of ["en", "hi", "zh"]) expect(isLocale(locale)).toBe(true);
  });

  it("rejects anything else, including non-strings", () => {
    for (const value of ["de", "es", "hi-IN", "", null, undefined, 3, {}]) {
      expect(isLocale(value)).toBe(false);
    }
  });
});

describe("resolveLocale", () => {
  it("takes the first supported tag from a browser list", () => {
    expect(resolveLocale(["hi-IN", "en-US"])).toBe("hi");
  });

  it("falls back to the base language for a region subtag", () => {
    expect(resolveLocale(["zh-CN"])).toBe("zh");
    expect(resolveLocale(["zh-TW"])).toBe("zh");
  });

  it("skips languages it does not speak and keeps looking", () => {
    expect(resolveLocale(["de-DE", "fr", "zh-Hant"])).toBe("zh");
  });

  it("reads an Accept-Language header with quality weights", () => {
    expect(resolveLocale("de-DE,de;q=0.9,hi;q=0.8,en;q=0.7")).toBe("hi");
  });

  it("defaults to English rather than failing", () => {
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(["de", "fr"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
  });
});

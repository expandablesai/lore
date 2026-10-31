/**
 * Supported interface languages.
 *
 * One list, shared by the console and the API, so a stored preference can never
 * be a language the picker does not offer. Deliberately free of node imports:
 * the browser bundle imports this module directly, while the API uses the same
 * constants to validate what it is told and to phrase the model's instruction.
 */

export const LOCALES = ["en", "hi", "zh"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Native names, for the picker: people recognise their own language, not its English name. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  zh: "中文",

};

/** English names, used when telling the model which language to answer in. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "Hindi",
  zh: "Simplified Chinese",

};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The first supported language in a browser list or an Accept-Language header.
 *
 * Region subtags fall back to their base language (`hi-IN` → `hi`, `zh-CN` →
 * `zh`), and anything unsupported resolves to English rather than failing —
 * an unknown browser language must never leave the console in a 4-language
 * limbo.
 */
export function resolveLocale(input: string | readonly string[] | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  const tags =
    typeof input === "string"
      ? input.split(",").map((part) => part.split(";")[0] ?? "")
      : [...input];
  for (const tag of tags) {
    const base = (tag.trim().toLowerCase().split("-")[0] ?? "").trim();
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

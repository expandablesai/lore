// Message timestamps, in the reader's language.
//
// One format everywhere: the day, then the time, joined by a connector the
// translation supplies — "Thu, Oct 15 at 8:23 PM" in English, "10月15日周四
// 20:23" in Chinese. Built from two Intl calls rather than a single pattern
// because Intl has no locale-independent way to say "at".
import type { Locale } from "@lore/core/locales";

export function formatWhen(
  iso: string | null | undefined,
  locale: Locale,
  t: (message: string, vars?: Record<string, string | number>) => string,
  /** Pinned for tests; browsers use their own zone. */
  timeZone?: string,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
  return t("{date} at {time}", { date: day, time });
}

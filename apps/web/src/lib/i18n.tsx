// Interface language.
//
// Three sources, in order: an explicit choice on this browser, the preference
// stored on the user row (so it follows them to another device), then the
// browser's own language list. English is the fallback for anything unsupported.
//
// The provider is optional on purpose: `useI18n` outside it renders the English
// source strings, which keeps single-view tests and storybook-style renders
// working without wrapping every one of them.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES, isLocale, resolveLocale } from "@lore/core/locales";
import type { Locale } from "@lore/core/locales";
import { api } from "./api";
import { useAuth } from "./auth";
import { MESSAGES } from "./messages";

export interface I18nState {
  /** The language actually in use. */
  locale: Locale;
  /** The pinned choice, or null when the language follows the browser. */
  choice: Locale | null;
  /** What the browser asked for, used as the default. */
  browserLocale: Locale;
  setLocale: (next: Locale | null) => void;
  /** Translate an English source string, with `{name}` placeholders. */
  t: (message: string, vars?: Record<string, string | number>) => string;
  /** Picker options: the native name of every supported language. */
  options: { value: Locale; label: string }[];
}

const STORAGE_KEY = "lore.locale";

function storedChoice(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function browserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const list = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return resolveLocale(list);
}

function translate(locale: Locale, message: string, vars?: Record<string, string | number>): string {
  let text = MESSAGES[locale][message] ?? message;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

const OPTIONS = LOCALES.map((value) => ({ value, label: LOCALE_LABELS[value] }));

const FALLBACK: I18nState = {
  locale: DEFAULT_LOCALE,
  choice: null,
  browserLocale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (message, vars) => translate(DEFAULT_LOCALE, message, vars),
  options: OPTIONS,
};

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { me, token } = useAuth();
  const browser = useMemo(browserLocale, []);
  const [choice, setChoiceState] = useState<Locale | null>(storedChoice);

  const serverChoice = me?.locale && isLocale(me.locale) ? me.locale : null;
  const locale: Locale = choice ?? serverChoice ?? browser;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale | null) => {
      setChoiceState(next);
      try {
        if (next) window.localStorage.setItem(STORAGE_KEY, next);
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // storage can be blocked; the server copy still persists the choice
      }
      if (token) {
        void api.updateMe(token, { locale: next }).catch(() => {
          // offline: the local choice still applies to this browser
        });
      }
    },
    [token],
  );

  const t = useCallback(
    (message: string, vars?: Record<string, string | number>) => translate(locale, message, vars),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, choice, browserLocale: browser, setLocale, t, options: OPTIONS }),
    [locale, choice, browser, setLocale, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  return useContext(I18nContext) ?? FALLBACK;
}

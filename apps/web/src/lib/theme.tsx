// Theme and lighting: light/dark/system plus an optional RGB neon layer.
//
// Both choices live on the user row so they follow the reader to another
// browser, with localStorage keeping the very first paint honest before /me
// answers. Neon is independent of the theme — it is a separate axis, so it can
// be on in day mode as well as at night.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api } from "./api";

export type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  resolved: "light" | "dark";
  neon: boolean;
  setTheme: (theme: Theme) => void;
  setNeon: (neon: boolean) => void;
}

const THEME_KEY = "lore.theme";
const NEON_KEY = "lore.neon";
const ThemeContext = createContext<ThemeState | null>(null);

function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // storage can be blocked; the system preference still applies
  }
  return "system";
}

function storedNeon(): boolean {
  try {
    return window.localStorage.getItem(NEON_KEY) === "on";
  } catch {
    return false;
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

export function ThemeProvider({ children, token }: { children: ReactNode; token: string | null }) {
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const [neon, setNeonState] = useState<boolean>(storedNeon);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  const resolved: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.neon = neon ? "on" : "off";
  }, [resolved, neon]);

  // Adopt the stored preferences once the session is known.
  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .me(token)
      .then((me) => {
        if (!active) return;
        if (me.theme === "light" || me.theme === "dark" || me.theme === "system") {
          setThemeState(me.theme);
        }
        if (typeof me.neon === "boolean") setNeonState(me.neon);
      })
      .catch(() => {
        // no session means no server preference; the local one stands
      });
    return () => {
      active = false;
    };
  }, [token]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // ignore: the server copy still persists
      }
      if (token) {
        void api.updateMe(token, { theme: next }).catch(() => {
          // offline: the local choice still applies to this browser
        });
      }
    },
    [token],
  );

  const setNeon = useCallback(
    (next: boolean) => {
      setNeonState(next);
      try {
        window.localStorage.setItem(NEON_KEY, next ? "on" : "off");
      } catch {
        // ignore
      }
      if (token) {
        void api.updateMe(token, { neon: next }).catch(() => {
          // offline: the local choice still applies to this browser
        });
      }
    },
    [token],
  );

  const value = useMemo(
    () => ({ theme, resolved, neon, setTheme, setNeon }),
    [theme, resolved, neon, setTheme, setNeon],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

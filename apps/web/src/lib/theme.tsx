// Theme: light, dark, or follow the system. The choice lives in the database so
// it follows the reader to another browser, with localStorage keeping the very
// first paint honest before /me answers.
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
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = "lore.theme";
const ThemeContext = createContext<ThemeState | null>(null);

function stored(): Theme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // storage can be blocked; the system preference still applies
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

export function ThemeProvider({ children, token }: { children: ReactNode; token: string | null }) {
  const [theme, setThemeState] = useState<Theme>(stored);
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
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  // Adopt the stored preference once the session is known.
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
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore: the server copy still persists
      }
      if (token) {
        void api.setTheme(token, next).catch(() => {
          // offline: the local choice still applies to this browser
        });
      }
    },
    [token],
  );

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

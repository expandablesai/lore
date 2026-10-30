// Minimal internal hash router. The console is served same-origin behind
// Caddy, so a hash route never hits the server and keeps dependencies free of
// react-router. Routes look like "#/documents/abc".
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface NavState {
  path: string;
  navigate: (path: string) => void;
}

const NavContext = createContext<NavState | null>(null);

function readPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "/";
}

export function NavProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(readPath);
  useEffect(() => {
    const onChange = () => setPath(readPath());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: string) => {
    if (readPath() === next) return;
    window.location.hash = next;
  }, []);
  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavProvider");
  return ctx;
}

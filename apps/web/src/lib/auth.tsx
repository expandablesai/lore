// Bearer session auth state. On mount a stored token is replayed against
// GET /auth/session to restore the signed-in user; a rejection clears it.
// login/signup persist the returned token so a reload can restore it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, type SignupInput } from "./api";
import type { AuthUser } from "./types";
import { clearToken, loadToken, saveToken } from "./session";

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = loadToken();
    if (!stored) {
      setLoading(false);
      return;
    }
    let active = true;
    api
      .session(stored)
      .then((res) => {
        if (!active) return;
        setUser(res.user);
        setToken(stored);
      })
      .catch(() => {
        if (!active) return;
        clearToken();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    saveToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const signup = useCallback(async (input: SignupInput) => {
    const res = await api.signup(input);
    saveToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, signup, logout }),
    [user, token, loading, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

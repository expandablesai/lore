// Sign-in / create-account gate. On success the AuthProvider holds the bearer
// session and App swaps in the console shell.
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, ErrorNote, Field, Panel } from "./common";

export function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup({ email, password, displayName, orgName });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-100">EXPANDABLES LORE</h1>
        <p className="text-sm text-slate-400">Admin Console</p>
      </div>
      <Panel>
        <form className="space-y-4" onSubmit={onSubmit}>
          <h2 className="text-lg font-medium text-slate-100">
            {mode === "login" ? "Sign in" : "Create your workspace"}
          </h2>

          {mode === "signup" && (
            <>
              <Field label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
              <Field label="Organization" value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="organization" />
            </>
          )}
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />

          {error && <ErrorNote message={error} />}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>

          <p className="text-center text-sm text-slate-400">
            {mode === "login" ? "New here? " : "Already have an account? "}
            <button
              type="button"
              className="text-sky-400 hover:underline"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </form>
      </Panel>
    </div>
  );
}

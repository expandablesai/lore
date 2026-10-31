// Console root: restores the bearer session, then shows either the auth gate
// or the authenticated shell. No router dependency — navigation is internal.
import { AuthProvider, useAuth } from "./lib/auth";
import { NavProvider } from "./lib/nav";
import { ThemeProvider } from "./lib/theme";
import { Shell } from "./Shell";
import { Login } from "./views/Login";

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-slate-400">Restoring session…</p>
    </div>
  );
}

function Gate() {
  const { user, token, loading } = useAuth();
  // The theme provider sits above the gate so the sign-in screen follows it too.
  return (
    <ThemeProvider token={token}>
      {loading ? <Splash /> : !user ? <Login /> : (
        <NavProvider>
          <Shell />
        </NavProvider>
      )}
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

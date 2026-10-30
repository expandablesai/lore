// Console root: restores the bearer session, then shows either the auth gate
// or the authenticated shell. No router dependency — navigation is internal.
import { AuthProvider, useAuth } from "./lib/auth";
import { NavProvider } from "./lib/nav";
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
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Login />;
  return (
    <NavProvider>
      <Shell />
    </NavProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

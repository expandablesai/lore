// Console root: restores the bearer session, then shows either the auth gate
// or the authenticated shell. No router dependency — navigation is internal.
import { AuthProvider, useAuth } from "./lib/auth";
import { I18nProvider, useI18n } from "./lib/i18n";
import { NavProvider } from "./lib/nav";
import { ThemeProvider } from "./lib/theme";
import { Shell } from "./Shell";
import { Login } from "./views/Login";

function Splash() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-slate-400">{t("Restoring session…")}</p>
    </div>
  );
}

function Gate() {
  const { user, token, loading } = useAuth();
  // Language and theme sit above the gate so the sign-in screen follows them too.
  return (
    <I18nProvider>
      <ThemeProvider token={token}>
        {loading ? <Splash /> : !user ? <Login /> : (
          <NavProvider>
            <Shell />
          </NavProvider>
        )}
      </ThemeProvider>
    </I18nProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

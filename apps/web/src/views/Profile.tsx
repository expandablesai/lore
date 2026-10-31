// Profile: your picture, your name, and how the console looks. The avatar is
// what colleagues see beside your messages, so it is edited here rather than
// buried in settings.
import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useTheme, type Theme } from "../lib/theme";
import { Avatar } from "../components/Brand";
import { Button, ErrorNote, Field, Panel, errMessage, type ViewProps } from "./common";

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Day" },
  { value: "dark", label: "Night" },
  { value: "system", label: "Auto" },
];

export function Profile({ token, user }: ViewProps) {
  const { me, refreshMe } = useAuth();
  const { theme, setTheme, neon, setNeon } = useTheme();
  const { t, options, choice, setLocale } = useI18n();
  const [name, setName] = useState(user.displayName);
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cacheBust, setCacheBust] = useState(0);

  // The picture is cached per (user, revision) so replacing it shows up at once.
  useEffect(() => {
    setName(user.displayName);
  }, [user.displayName]);

  const onPick = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setUploading(true);
      setError(null);
      setNotice(null);
      try {
        await api.uploadAvatar(token, file);
        await refreshMe();
        setCacheBust((n) => n + 1);
        setNotice(t("Profile picture updated."));
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setUploading(false);
      }
    },
    [refreshMe, t, token],
  );

  const onRemoveAvatar = useCallback(async () => {
    setError(null);
    try {
      await api.deleteAvatar(token);
      await refreshMe();
      setCacheBust((n) => n + 1);
      setNotice(t("Profile picture removed."));
    } catch (e) {
      setError(errMessage(e));
    }
  }, [refreshMe, token]);

  const onSaveName = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setDisplayNameSaving(true);
      setError(null);
      setNotice(null);
      try {
        await api.updateMe(token, { displayName: name.trim() });
        await refreshMe();
        setNotice(t("Name updated."));
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setDisplayNameSaving(false);
      }
    },
    [name, refreshMe, t, token],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">{t("Profile")}</h1>
        <p className="text-xs text-slate-400">{t("Your picture appears beside every message you send.")}</p>
      </header>

      <Panel>
        <div className="flex flex-wrap items-center gap-5">
          <div key={cacheBust} className="relative">
            <Avatar
              token={token}
              userId={user.id}
              hasAvatar={Boolean(me?.hasAvatar)}
              name={user.displayName}
              size={72}
            />
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="glass liquid-lift cursor-pointer rounded-full px-4 py-2 text-sm text-slate-200">
                {uploading ? t("Uploading…") : me?.hasAvatar ? t("Change picture") : t("Upload picture")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onPick}
                  className="hidden"
                  aria-label="Profile picture"
                />
              </label>
              {me?.hasAvatar && (
                <Button variant="ghost" onClick={() => void onRemoveAvatar()}>
                  {t("Remove")}
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 5 MB.</p>
          </div>
        </div>

        <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={onSaveName}>
          <Field label={t("Display name")} value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{t("Email")}</span>
            <p className="rounded-2xl border border-[rgb(var(--glass-border))] px-3.5 py-2.5 text-sm text-slate-400">
              {user.email}
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={displayNameSaving || name.trim() === ""}>
              {displayNameSaving ? t("Saving…") : t("Save name")}
            </Button>
          </div>
        </form>

        {error && <div className="mt-3"><ErrorNote message={error} /></div>}
        {notice && <p className="mt-3 text-xs text-emerald-300">{notice}</p>}
      </Panel>

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">{t("Appearance")}</h2>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex rounded-full bg-slate-800/50 p-1 text-xs">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                aria-pressed={theme === option.value}
                className={
                  "rounded-full px-3 py-1.5 transition " +
                  (theme === option.value
                    ? "bg-slate-100 text-slate-900 shadow"
                    : "text-slate-400 hover:text-slate-200")
                }
              >
                {t(option.label)}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={neon}
            onClick={() => setNeon(!neon)}
            className={
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition " +
              (neon ? "bg-slate-800/70 text-slate-100" : "text-slate-400 hover:text-slate-200")
            }
          >
            <span
              aria-hidden="true"
              className={
                "relative h-4 w-8 rounded-full transition " +
                (neon ? "bg-[linear-gradient(90deg,#ff2d55,#32d74b,#64d2ff,#bf5af2)] neon-glow" : "bg-slate-700")
              }
            >
              <span
                className={
                  "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all " +
                  (neon ? "left-4" : "left-0.5")
                }
              />
            </span>
            {t("Neon lights")}
          </button>
        </div>

        {/*
          Language: an explicit choice beats the browser, and the browser's own
          language is the default so a first visit is already in the right
          language without anyone opening this page.
        */}
        <div className="mt-5 border-t border-[rgb(var(--glass-border))] pt-4">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{t("Language")}</span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                lang={option.value}
                aria-pressed={choice === option.value}
                onClick={() => {
                  setLocale(option.value);
                  setNotice(t("Language updated."));
                }}
                className={
                  "rounded-full px-3 py-1.5 text-xs transition " +
                  (choice === option.value
                    ? "bg-slate-100 text-slate-900 shadow"
                    : "glass text-slate-300 hover:text-slate-100")
                }
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={choice === null}
              onClick={() => {
                setLocale(null);
                setNotice(t("Language updated."));
              }}
              className={
                "rounded-full px-3 py-1.5 text-xs transition " +
                (choice === null
                  ? "bg-slate-100 text-slate-900 shadow"
                  : "text-slate-400 hover:text-slate-200")
              }
            >
              {t("Follows your browser")}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">{t("Language follows your browser unless you pick one.")}</p>
        </div>
      </Panel>
    </div>
  );
}

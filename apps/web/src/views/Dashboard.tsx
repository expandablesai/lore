// Dashboard: greets the signed-in user and lists their organizations.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Org } from "../lib/types";
import { Badge, ErrorNote, Panel, StatusLine, errMessage, type ViewProps } from "./common";

export function Dashboard({ token, user }: ViewProps) {
  const { t } = useI18n();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .orgs(token)
      .then((res) => {
        if (active) setOrgs(res);
      })
      .catch((e: unknown) => {
        if (active) setError(errMessage(e));
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{t("Welcome back, {name}", { name: user.displayName })}</h1>
        <p className="mt-1 text-sm text-slate-400">
          Signed in as <Badge tone="sky">{user.role}</Badge>
        </p>
      </div>

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">{t("Organizations")}</h2>
        {error && <ErrorNote message={error} />}
        {!error && orgs === null && <StatusLine>Loading organizations…</StatusLine>}
        {orgs !== null && orgs.length === 0 && <StatusLine>No organizations yet.</StatusLine>}
        {orgs !== null && orgs.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {orgs.map((org) => (
              <li key={org.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-100">{org.name}</span>
                  <Badge>{org.mode}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">/{org.slug}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

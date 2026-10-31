// Members: list the organization's users and (for admins) add a new member.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { OrgMember, Role } from "../lib/types";
import { Badge, Button, ErrorNote, Field, Panel, StatusLine, errMessage, type ViewProps } from "./common";

const ADDABLE_ROLES: Exclude<Role, "superadmin">[] = ["org_admin", "member", "viewer"];

function canManage(role: Role): boolean {
  return role === "superadmin" || role === "org_admin";
}

export function Members({ token, user }: ViewProps) {
  const { t } = useI18n();
  const orgId = user.orgId;
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Exclude<Role, "superadmin">>("member");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .orgMembers(token, orgId)
      .then((res) => setMembers(res))
      .catch((e: unknown) => setError(errMessage(e)));
  }, [token, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      await api.addMember(token, orgId, { email, displayName, password, role });
      setEmail("");
      setDisplayName("");
      setPassword("");
      setRole("member");
      load();
    } catch (e) {
      setAddError(errMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">{t("Members")}</h1>

      {canManage(user.role) && (
        <Panel>
          <h2 className="mb-3 text-sm font-medium text-slate-200">{t("Add a member")}</h2>
          <form className="space-y-3" onSubmit={onAdd}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <Field label="Temporary password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-300">Role</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Exclude<Role, "superadmin">)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                >
                  {ADDABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {addError && <ErrorNote message={addError} />}
            <Button type="submit" disabled={adding}>
              {adding ? "Adding…" : "Add member"}
            </Button>
          </form>
        </Panel>
      )}

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">{t("Organization users")}</h2>
        {error && <ErrorNote message={error} />}
        {!error && members === null && <StatusLine>Loading members…</StatusLine>}
        {members !== null && members.length === 0 && <StatusLine>No members yet.</StatusLine>}
        {members !== null && members.length > 0 && (
          <ul className="divide-y divide-slate-800">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm text-slate-100">{m.displayName}</p>
                  <p className="text-xs text-slate-500">{m.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={m.role === "superadmin" ? "rose" : m.role === "org_admin" ? "sky" : "slate"}>{m.role}</Badge>
                  <Badge tone={m.status === "active" ? "emerald" : "amber"}>{m.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

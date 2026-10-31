// Memory: the one place where things go in. Pasted text and images are written
// into the workspace at the top of the page; below that you can recall
// assertions by query, write a remember triple, and forget one. Recall/remember
// /forget all ride the bearer session.
import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { Assertion, AssertionStatus, Scope } from "../lib/types";
import { Capture } from "./Capture";
import { Badge, Button, ErrorNote, Field, Panel, StatusLine, errMessage, type ViewProps } from "./common";

const SCOPES: Scope[] = ["personal", "project", "org"];

function statusTone(status: AssertionStatus): "emerald" | "amber" | "rose" | "slate" {
  if (status === "confirmed") return "emerald";
  if (status === "disputed" || status === "superseded") return "amber";
  if (status === "deleted") return "rose";
  return "slate";
}

export function Memory({ token, user, navigate }: ViewProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("org");
  const [assertions, setAssertions] = useState<Assertion[] | null>(null);
  const [recallError, setRecallError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [subject, setSubject] = useState("");
  const [predicate, setPredicate] = useState("");
  const [object, setObject] = useState("");
  const [sources, setSources] = useState("");
  // Remembering has its own scope. Sharing the Recall selector's state meant a
  // fact written after searching "personal" was stored personal — invisible to
  // the organisation — with no control on the form saying so.
  const [rememberScope, setRememberScope] = useState<Scope>("org");
  const [rememberError, setRememberError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setRecallError(null);
    try {
      const res = await api.recall(token, { query: query || undefined, scope });
      setAssertions(res);
    } catch (e) {
      setRecallError(errMessage(e));
    } finally {
      setSearching(false);
    }
  }

  async function onRemember(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setRememberError(null);
    try {
      const sourceList = sources
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await api.remember(token, {
        scope: rememberScope,
        subject,
        predicate,
        object,
        sources: sourceList.length > 0 ? sourceList : ["console"],
      });
      setSubject("");
      setPredicate("");
      setObject("");
      setSources("");
    } catch (e) {
      setRememberError(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function onForget(id: string) {
    setRecallError(null);
    try {
      await api.forget(token, { id });
      setAssertions((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    } catch (e) {
      setRecallError(errMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Memory</h1>
        <p className="mt-1 text-xs text-slate-400">
          Paste something to keep it, or write a fact, then recall it later.
        </p>
      </header>

      <Capture token={token} user={user} navigate={navigate} />

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">Remember a fact</h2>
        <form className="space-y-3" onSubmit={onRemember}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
            <Field label="Predicate" value={predicate} onChange={(e) => setPredicate(e.target.value)} required />
            <Field label="Object" value={object} onChange={(e) => setObject(e.target.value)} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem] sm:items-end">
            <Field label="Sources (comma-separated)" value={sources} onChange={(e) => setSources(e.target.value)} placeholder="notes.txt, https://…" />
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Scope</span>
              <select
                aria-label="Fact scope"
                value={rememberScope}
                onChange={(e) => setRememberScope(e.target.value as Scope)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {rememberError && <ErrorNote message={rememberError} />}
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Remember"}
          </Button>
        </form>
      </Panel>

      <Panel>
        <h2 className="mb-3 text-sm font-medium text-slate-200">Recall</h2>
        <form className="flex flex-wrap items-end gap-3" onSubmit={onSearch}>
          <div className="min-w-[12rem] flex-1">
            <Field label="Query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="sky" />
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-300">Scope</span>
            <select
              aria-label="Recall scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </form>

        {recallError && (
          <div className="mt-3">
            <ErrorNote message={recallError} />
          </div>
        )}

        <div className="mt-4">
          {assertions === null ? (
            <StatusLine>Run a recall to see assertions.</StatusLine>
          ) : assertions.length === 0 ? (
            <StatusLine>No matching assertions.</StatusLine>
          ) : (
            <ul className="divide-y divide-slate-800">
              {assertions.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-100">
                      {a.subject} <span className="text-slate-500">{a.predicate}</span> {a.object}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {a.scope} · trust {a.trust} · confidence {a.confidence}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                    <Button variant="danger" onClick={() => void onForget(a.id)}>
                      Forget
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}
